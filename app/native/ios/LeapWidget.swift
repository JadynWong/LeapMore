import AppIntents
import SwiftUI
import WidgetKit

private struct Snapshot: Decodable {
    var soc: String? = nil
    var range: String? = nil
    var fuel: String? = nil
    var state: String? = nil
    var charging: String? = nil
    var chargeStatus: String? = nil
    var power: String? = nil
    var inside: String? = nil
    var locked: String? = nil
    var odometer: String? = nil
    var lockAction: String? = nil
    var climateOn: Bool? = nil
    var trunkOpen: Bool? = nil
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
    private var background: Color {
        if family == .systemMedium {
            return scheme == .dark ? Color(red: 0.106, green: 0.157, blue: 0.176) : Color(red: 0.957, green: 0.976, blue: 0.984)
        }
        return scheme == .dark ? Color(red: 0.10, green: 0.19, blue: 0.17) : Color(red: 0.90, green: 0.95, blue: 0.93)
    }
    private var tile: Color { scheme == .dark ? Color(red: 0.153, green: 0.220, blue: 0.247) : Color(red: 0.898, green: 0.929, blue: 0.945) }
    private var item: Snapshot { entry.value }
    private var state: String { entry.stale && entry.updated != nil ? "缓存车况" : item.state ?? "状态未知" }

    @ViewBuilder
    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
        .lineLimit(1).minimumScaleFactor(0.65).frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func actionLabel(_ title: String, systemImage: String, active: Bool) -> some View {
        if family == .systemMedium {
            VStack(spacing: 3) {
                Image(systemName: systemImage).font(.system(size: 14, weight: .medium))
                Text(title).font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity, minHeight: 38)
            .background(active ? Color.green.opacity(0.22) : tile, in: RoundedRectangle(cornerRadius: 11))
        } else {
            Label(title, systemImage: systemImage).font(.caption2).lineLimit(1)
                .frame(maxWidth: .infinity).padding(.vertical, 5).background(.green.opacity(0.16), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    @ViewBuilder
    private func action(_ title: String, systemImage: String, key: String, permitted: Bool?, active: Bool = false) -> some View {
        let label = actionLabel(title, systemImage: systemImage, active: active)
        if family == .systemSmall, #available(iOSApplicationExtension 17.0, *), permitted == true, !entry.stale {
            Button(intent: VehicleActionIntent(key)) { label }.buttonStyle(.plain)
        } else if family != .systemSmall, permitted == true, !entry.stale,
                  let url = URL(string: "com.leapmore.app://widget/action?action=" + key) {
            Link(destination: url) { label }
        } else { label.opacity(0.65) }
    }

    private var fullActions: some View {
        HStack(spacing: family == .systemMedium ? 5 : 4) {
            action(item.lockAction ?? "解锁", systemImage: family == .systemMedium && item.lockAction == "解锁" ? "lock.open" : "lock",
                   key: "lock", permitted: item.canLock, active: item.lockAction == "上锁")
            action("空调", systemImage: "fan", key: "climate", permitted: item.canControl, active: item.climateOn == true)
            action("后备箱", systemImage: "car", key: "trunk", permitted: item.canControl, active: item.trunkOpen == true)
            action("寻车", systemImage: "speaker.wave.2", key: "find", permitted: item.canControl)
        }
    }

    private func mediumMetric(_ title: String, value: String, unit: String) -> some View {
        let hasUnit = value.hasSuffix(unit)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: unit == "%" ? 0 : 3) {
                Text(hasUnit ? String(value.dropLast(unit.count)).trimmingCharacters(in: .whitespaces) : value)
                    .font(.system(size: 26, weight: .bold)).monospacedDigit()
                if hasUnit { Text(unit).font(.system(size: 12, weight: .semibold)) }
            }
            .lineLimit(1).minimumScaleFactor(0.65)
            Text(title).font(.system(size: 11)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var mediumContent: some View {
        let charging = item.chargeStatus == "charging"
        return VStack(spacing: 3) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    mediumMetric(item.fuel?.isEmpty == false ? "综合续航" : "续航", value: item.range ?? "— km", unit: "km")
                    Text(state).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
                mediumMetric("电量", value: item.soc ?? "—", unit: "%")
                VStack(alignment: .trailing, spacing: 3) {
                    Image(systemName: "car.fill").font(.system(size: 23))
                    Label(item.charging ?? "状态未知", systemImage: charging ? "bolt.fill" : "powerplug")
                        .font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
                        .padding(.horizontal, 4).padding(.vertical, 3)
                        .background(charging || item.chargeStatus == "done" ? Color.green.opacity(0.22) : tile,
                                    in: RoundedRectangle(cornerRadius: 5))
                    if let power = item.power, !power.isEmpty { Text(power).font(.system(size: 10)).lineLimit(1) }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            Spacer(minLength: 2)
            fullActions
        }
    }

    private var otherContent: some View {
        VStack(alignment: .leading, spacing: family == .systemSmall ? 4 : 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.range ?? "— km").font(.title2.bold()).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
                if family != .systemSmall {
                    Spacer(minLength: 4)
                    Text(state).font(.caption2).lineLimit(1)
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
            } else { fullActions }
        }
    }

    var body: some View {
        let content = Group {
            if family == .systemMedium { mediumContent }
            else { otherContent }
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
