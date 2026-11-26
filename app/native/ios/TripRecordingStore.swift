import Foundation
import SQLite3

struct TripBinding: Codable, Equatable {
    let account: String
    let id: String
    let vin: String
    let name: String
    var key: String { DirectQuickRuntime.json([account, id, vin.uppercased()]) }
}

struct TripRecordingState: Codable {
    let vehicle: TripBinding
    var phase: String
    var lastSample: Int64 = 0
    var sampledAt: Int64?
    var count = 0
    var note = ""
    var active: Bool { phase == "starting" || phase == "recording" }

    var payload: [String: Any] {
        ["vehicle": vehicle.name, "vehicleId": vehicle.id, "scope": vehicle.key, "phase": phase, "lastSample": sampledAt ?? lastSample, "count": count, "note": note]
    }
}

enum TripStorageError: LocalizedError {
    case unavailable
    var errorDescription: String? { "无法读写本机行程记录" }
}

// Only the recorder's main queue accesses this connection. Samples are acknowledged after IndexedDB commits.
final class TripRecordingStore {
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(url: URL) throws {
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { sqlite3_close(db); throw TripStorageError.unavailable }
        try execute("CREATE TABLE IF NOT EXISTS sessions (scope TEXT PRIMARY KEY, state TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS samples (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, frame TEXT NOT NULL)")
        try execute("CREATE INDEX IF NOT EXISTS trip_pending ON samples(scope,seq)")
    }
    deinit { sqlite3_close(db) }

    @discardableResult
    private func execute(_ sql: String, _ args: [String] = [], row: ((OpaquePointer) throws -> Void)? = nil) throws -> Int {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { throw TripStorageError.unavailable }
        defer { sqlite3_finalize(stmt) }
        for (i, arg) in args.enumerated() {
            guard sqlite3_bind_text(stmt, Int32(i + 1), arg, -1, transient) == SQLITE_OK else { throw TripStorageError.unavailable }
        }
        var rc = sqlite3_step(stmt)
        while rc == SQLITE_ROW { try row?(stmt); rc = sqlite3_step(stmt) }
        guard rc == SQLITE_DONE else { throw TripStorageError.unavailable }
        return Int(sqlite3_changes(db))
    }
    func states() throws -> [TripRecordingState] {
        var result: [TripRecordingState] = []
        try execute("SELECT state FROM sessions") { stmt in
            let raw = String(cString: sqlite3_column_text(stmt, 0))
            result.append(try JSONDecoder().decode(TripRecordingState.self, from: Data(raw.utf8)))
        }
        return result
    }
    func save(_ state: TripRecordingState, frame: [String: Any]? = nil) throws {
        let data = try JSONEncoder().encode(state)
        try execute("BEGIN IMMEDIATE")
        do {
            if let frame {
                let encoded = try JSONSerialization.data(withJSONObject: frame)
                try execute("INSERT INTO samples(scope,frame) VALUES(?,?)", [state.vehicle.key, String(decoding: encoded, as: UTF8.self)])
            }
            try execute("INSERT OR REPLACE INTO sessions(scope,state) VALUES(?,?)", [state.vehicle.key, String(decoding: data, as: UTF8.self)])
            try execute("COMMIT")
        } catch { _ = try? execute("ROLLBACK"); throw error }
    }
    func finish(_ state: TripRecordingState, interrupted: Bool, note: String) throws -> TripRecordingState {
        var next = state
        next.phase = interrupted ? "interrupted" : "ended"
        next.note = note
        let boundary: [String: Any]? = state.count > 0 && state.lastSample > 0 ?
            ["at": state.lastSample + 1, "data": [:], "changed": [], "tripBoundary": next.phase] : nil
        try save(next, frame: boundary)
        return next
    }
    func batch(_ key: String) throws -> [String: Any] {
        var frames: [Any] = [], cursor: Int64 = 0
        try execute("SELECT seq,frame FROM samples WHERE scope=? ORDER BY seq LIMIT 256", [key]) { stmt in
            cursor = sqlite3_column_int64(stmt, 0)
            let raw = String(cString: sqlite3_column_text(stmt, 1))
            frames.append(try JSONSerialization.jsonObject(with: Data(raw.utf8)))
        }
        return ["cursor": cursor, "frames": frames]
    }
    func ack(_ key: String, cursor: Int) throws { try execute("DELETE FROM samples WHERE scope=? AND seq<=?", [key,String(cursor)]) }
    func clear(_ key: String) throws {
        try execute("BEGIN IMMEDIATE")
        do {
            try execute("DELETE FROM samples WHERE scope=?", [key]); try execute("DELETE FROM sessions WHERE scope=?", [key]); try execute("COMMIT")
        } catch { _ = try? execute("ROLLBACK"); throw error }
    }
}
