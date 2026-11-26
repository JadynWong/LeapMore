import AppIntents
import Foundation
import WidgetKit

struct QuickTargetRecord: Codable {
    let id: String
    let title: String
    let preset: Bool

    static func catalog() -> [Self] {
        guard let data = LeapWidgetStorage.defaults?.data(forKey: "quick-targets") else { return [] }
        return (try? JSONDecoder().decode([Self].self, from: data)) ?? []
    }
}

@available(iOS 18.0, *)
struct QuickVehicleEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "车辆")
    static let defaultQuery = VehicleQuery()
    let id: String
    let name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    struct VehicleQuery: EntityQuery {
        func suggestedEntities() async throws -> [QuickVehicleEntity] {
            QuickTargetRecord.catalog().filter { !$0.preset }.map { QuickVehicleEntity(id: $0.id, name: $0.title) }
        }
        func entities(for identifiers: [String]) async throws -> [QuickVehicleEntity] {
            try await suggestedEntities().filter { identifiers.contains($0.id) }
        }
    }
}

@available(iOS 18.0, *)
struct QuickPresetEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "车辆与备车预设")
    static let defaultQuery = PresetQuery()
    let id: String
    let name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }

    struct PresetQuery: EntityQuery {
        func suggestedEntities() async throws -> [QuickPresetEntity] {
            QuickTargetRecord.catalog().filter(\.preset).map { QuickPresetEntity(id: $0.id, name: $0.title) }
        }
        func entities(for identifiers: [String]) async throws -> [QuickPresetEntity] {
            try await suggestedEntities().filter { identifiers.contains($0.id) }
        }
    }
}

@available(iOS 18.0, *)
struct QuickVehicleConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "绑定车辆"
    @Parameter(title: "车辆") var vehicle: QuickVehicleEntity?
}

@available(iOS 18.0, *)
struct QuickPresetConfiguration: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "绑定备车预设"
    @Parameter(title: "车辆与预设") var preset: QuickPresetEntity?
}

@available(iOS 18.0, *)
enum QuickVehicleAction: String, AppEnum {
    case prepare, climateOn = "climate-on", climateOff = "climate-off", lock = "lock-only", find
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "快捷控制")
    static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .prepare: "一键备车", .climateOn: "开启空调", .climateOff: "关闭空调", .lock: "锁车", .find: "鸣笛寻车"
    ]
}

@available(iOS 18.0, *)
enum QuickControlFeedback {
    static func key(_ action: QuickVehicleAction) -> String { "quick-result-" + action.rawValue }
    static func label(_ action: QuickVehicleAction, _ target: String?) -> String? {
        guard let target, let result = LeapWidgetStorage.defaults?.dictionary(forKey: key(action)),
              result["target"] as? String == target, let date = result["at"] as? Date,
              let message = result["message"] as? String else { return nil }
        return date.formatted(date: .omitted, time: .shortened) + " · " + message
    }
}
@available(iOS 18.0, *)
struct DirectVehicleIntent: AppIntent {
    static let title: LocalizedStringResource = "执行车辆快捷控制"
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    static let isDiscoverable = false
    @Parameter(title: "操作") var action: QuickVehicleAction
    @Parameter(title: "绑定目标") var targetID: String

    init() {}
    init(_ action: QuickVehicleAction, _ targetID: String?) {
        self.action = action
        self.targetID = targetID ?? ""
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let message = await DirectQuickRuntime.run(action: action.rawValue, target: targetID)
        LeapWidgetStorage.defaults?.set(["target": targetID, "message": message, "at": Date.now], forKey: QuickControlFeedback.key(action))
        ControlCenter.shared.reloadControls(ofKind: "com.leapmore." + action.rawValue)
        return .result(dialog: "\(message)")
    }
}
