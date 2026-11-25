import AppIntents
import SwiftUI
import WidgetKit

private struct Snapshot: Decodable {
    var soc: String? = nil
    var range: String? = nil
    var fuel: String? = nil
    var state: String? = nil
    var charging: String? = nil
    var power: String? = nil
    var inside: String? = nil
    var locked: String? = nil
    var odometer: String? = nil
    var lockAction: String? = nil
    var simulated: Bool? = nil
    var canLock: Bool? = nil
    var canControl: Bool? = nil
}
private struct VehicleEntry: TimelineEntry {
    let date: Date
    let value: Snapshot
    let updated: Date?
    var stale: Bool { updated.map { date.timeIntervalSince($0) > 900 } ?? true }
}
private struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> VehicleEntry {
        let value = Snapshot(soc: "42%", range: "195 km", state: "已驻车", charging: "未插枪", inside: "24.0℃", locked: "已锁", odometer: "4200 km")
        return VehicleEntry(date: .now, value: value, updated: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (VehicleEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : read(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<VehicleEntry>) -> Void) {
        let now = Date.now
        let entry = read(date: now)
        if let updated = entry.updated, !entry.stale {
            completion(Timeline(entries: [entry, VehicleEntry(date: updated.addingTimeInterval(901), value: entry.value, updated: updated)], policy: .never))
        } else {
            completion(Timeline(entries: [entry], policy: .never))
        }
    }

    private func read(date: Date) -> VehicleEntry {
        let prefs = LeapWidgetStorage.defaults
        let value = prefs?.data(forKey: "vehicle-summary").flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) } ?? Snapshot()
        return VehicleEntry(date: date, value: value, updated: prefs?.object(forKey: "vehicle-summary-at") as? Date)
    }
}

private struct Card: View {
    let entry: VehicleEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    private var background: Color { scheme == .dark ? Color(red: 0.10, green: 0.19, blue: 0.17) : Color(red: 0.90, green: 0.95, blue: 0.93) }
    private var item: Snapshot { entry.value }

    @ViewBuilder
    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
        .lineLimit(1).minimumScaleFactor(0.65).frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func action(_ title: String, systemImage: String, key: String, permitted: Bool?) -> some View {
        let label = Label(title, systemImage: systemImage).font(.caption2).lineLimit(1)
            .frame(maxWidth: .infinity).padding(.vertical, 5).background(.green.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
        if family == .systemSmall, #available(iOSApplicationExtension 17.0, *), permitted == true, !entry.stale {
            Button(intent: VehicleActionIntent(key)) { label }.buttonStyle(.plain)
        } else if family != .systemSmall, permitted == true, !entry.stale,
                  let url = URL(string: "com.leapmore.app://widget/action?action=" + key) {
            Link(destination: url) { label }
        } else { label.opacity(0.65) }
    }

    var body: some View {
        let content = VStack(alignment: .leading, spacing: family == .systemSmall ? 4 : 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.range ?? "— km").font(.title2.bold()).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                if family != .systemSmall {
                    Spacer(minLength: 4)
                    Text(entry.stale && entry.updated != nil ? "缓存车况" : item.state ?? "状态未知").font(.caption2).lineLimit(1)
                }
            }
            Text([item.soc ?? "—", item.charging ?? "状态未知", family == .systemSmall ? nil : item.power].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.caption).lineLimit(1)
            if family == .systemLarge {
                if let fuel = item.fuel, !fuel.isEmpty { Label("油量 " + fuel, systemImage: "fuelpump").font(.caption) }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    metric("车门", value: item.locked ?? "—")
                    metric("车内温度", value: item.inside ?? "—")
                    if let distance = item.odometer, !distance.isEmpty { metric("总里程", value: distance) }
                }
            }
            if family == .systemSmall {
                HStack(spacing: 4) {
                    action(item.lockAction ?? "解锁", systemImage: "lock", key: "lock", permitted: item.canLock)
                    action("空调", systemImage: "fan", key: "climate", permitted: item.canControl)
                }
            } else {
                HStack(spacing: 4) {
                    action(item.lockAction ?? "解锁", systemImage: "lock", key: "lock", permitted: item.canLock)
                    action("空调", systemImage: "fan", key: "climate", permitted: item.canControl)
                    action("后备箱", systemImage: "car", key: "trunk", permitted: item.canControl)
                    action("寻车", systemImage: "speaker.wave.2", key: "find", permitted: item.canControl)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "com.leapmore.app://widget/action?action=open"))
        if #available(iOSApplicationExtension 17.0, *) {
            content.containerBackground(background, for: .widget)
        } else { content.padding(10).background(background) }
    }
}

@main
struct LeapMoreWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LeapMoreVehicle", provider: Provider()) { entry in Card(entry: entry) }
            .configurationDisplayName("LeapMore 车辆")
            .description("在桌面查看续航、充电与车况。")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
