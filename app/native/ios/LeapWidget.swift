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
    var colorScheme: String? = nil
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
    private var item: Snapshot { entry.value }
    private var small: Bool { family == .systemSmall }
    private var dark: Bool { item.colorScheme.map { $0 == "dark" } ?? (scheme == .dark) }
    private var background: Color { palette(0xf4f9fb, 0x1b282d) }
    private var tile: Color { palette(0xe5edf1, 0x27383f) }
    private var ink: Color { palette(0x17313b, 0xedf4f5) }
    private var muted: Color { palette(0x49616a, 0xa7bbc0) }
    private var accent: Color { palette(0x176556, 0x90dcc9) }
    private var selected: Color { palette(0xd5ebe4, 0x294a43) }
    private var state: String { entry.stale && entry.updated != nil ? "缓存车况" : item.state ?? "状态未知" }

    private func palette(_ light: UInt32, _ darkColor: UInt32) -> Color {
        let rgb = dark ? darkColor : light
        return Color(red: Double(rgb >> 16) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }

    private func metric(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(muted)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit()
        }
        .lineLimit(1).minimumScaleFactor(0.65).frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 7).padding(.vertical, 6)
        .background(tile, in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func action(_ title: String, systemImage: String, key: String, permitted: Bool?, active: Bool = false) -> some View {
        let label = VStack(spacing: 3) {
            Image(systemName: systemImage).font(.system(size: 14, weight: .medium))
            Text(title).font(.system(size: 11)).lineLimit(1).minimumScaleFactor(0.75)
        }
        .foregroundStyle(active ? accent : ink)
        .frame(maxWidth: .infinity, minHeight: small ? 34 : 38)
        .background(active ? selected : tile, in: RoundedRectangle(cornerRadius: 11))
        if small, #available(iOSApplicationExtension 17.0, *), permitted == true, !entry.stale {
            Button(intent: VehicleActionIntent(key)) { label }.buttonStyle(.plain)
        } else if !small, permitted == true, !entry.stale,
                  let url = URL(string: "com.leapmore.app://widget/action?action=" + key) {
            Link(destination: url) { label }
        } else { label.opacity(0.65) }
    }

    private var actions: some View {
        let lockTitle = item.lockAction ?? "解锁"
        return HStack(spacing: 5) {
            action(lockTitle, systemImage: lockTitle == "解锁" ? "lock.open" : "lock",
                   key: "lock", permitted: item.canLock, active: lockTitle == "上锁")
            action("空调", systemImage: "fan", key: "climate", permitted: item.canControl, active: item.climateOn == true)
            if !small {
                action("后备箱", systemImage: "car", key: "trunk", permitted: item.canControl, active: item.trunkOpen == true)
                action("寻车", systemImage: "speaker.wave.2", key: "find", permitted: item.canControl)
            }
        }
    }

    private func headline(_ title: String, value: String, unit: String) -> some View {
        let hasUnit = value.hasSuffix(unit)
        return VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: unit == "%" ? 0 : 3) {
                Text(hasUnit ? String(value.dropLast(unit.count)).trimmingCharacters(in: .whitespaces) : value)
                    .font(.system(size: small ? 22 : family == .systemLarge ? 32 : 26, weight: .bold)).monospacedDigit()
                if hasUnit { Text(unit).font(.system(size: small ? 10 : 12, weight: .semibold)) }
            }
            .lineLimit(1).minimumScaleFactor(0.65)
            Text(title).font(.system(size: 11)).foregroundStyle(muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var range: some View {
        headline(item.fuel?.isEmpty == false ? "综合续航" : "续航", value: item.range ?? "— km", unit: "km")
    }

    private var chargeBadge: some View {
        let charging = item.chargeStatus == "charging"
        let highlighted = charging || item.chargeStatus == "done"
        return Label(item.charging ?? "状态未知", systemImage: charging ? "bolt.fill" : "powerplug")
            .font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.75)
            .foregroundStyle(highlighted ? accent : muted)
            .padding(.horizontal, 4).padding(.vertical, 3)
            .background(highlighted ? selected : tile, in: RoundedRectangle(cornerRadius: 5))
    }

    @ViewBuilder
    private var power: some View {
        if let value = item.power, !value.isEmpty {
            Text(value).font(.system(size: 10, weight: .semibold)).lineLimit(1)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: small ? 4 : 8) {
            VStack(alignment: .leading, spacing: 2) {
                range
                if !small { Text(state).font(.system(size: 11)).foregroundStyle(muted).lineLimit(1) }
            }
            if family != .systemLarge { headline("电量", value: item.soc ?? "—", unit: "%") }
            if !small {
                VStack(alignment: .trailing, spacing: 3) {
                    Image(systemName: "car.fill")
                        .font(.system(size: family == .systemLarge ? 42 : 23))
                        .accessibilityHidden(true)
                    if family == .systemMedium {
                        HStack(spacing: 4) {
                            chargeBadge
                            power
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private func level(_ title: String, systemImage: String, value: String?, tint: Color) -> some View {
        let percent = value.flatMap { Double($0.dropLast($0.hasSuffix("%") ? 1 : 0)) }
        let fraction = min(100, max(0, percent ?? 0)) / 100
        return HStack(spacing: 6) {
            Label(title, systemImage: systemImage).foregroundStyle(muted)
            GeometryReader { proxy in
                Capsule().fill(tile).overlay(alignment: .leading) {
                    Capsule().fill(tint).frame(width: proxy.size.width * CGFloat(fraction))
                }
            }
            .frame(height: 5).accessibilityHidden(true)
            Text(percent == nil ? "—" : value ?? "—").monospacedDigit().frame(minWidth: 30, alignment: .trailing)
        }
        .font(.system(size: 11)).lineLimit(1)
    }

    var body: some View {
        let content = VStack(alignment: .leading, spacing: family == .systemLarge ? 7 : 3) {
            header
            if family == .systemLarge {
                VStack(spacing: 5) {
                    level("电量", systemImage: "battery.100", value: item.soc, tint: accent)
                    if let fuel = item.fuel, !fuel.isEmpty {
                        level("油量", systemImage: "fuelpump", value: fuel, tint: palette(0xa46a1b, 0xe2ac65))
                    }
                }
            }
            if family != .systemMedium {
                HStack {
                    chargeBadge
                    if family == .systemLarge {
                        Spacer(minLength: 4)
                        power
                    }
                }
            }
            if family == .systemLarge {
                HStack(spacing: 6) {
                    metric("车门", value: item.locked == "锁状态未知" ? "—" : item.locked ?? "—")
                    metric("车内温度", value: item.inside ?? "—")
                    if let distance = item.odometer, !distance.isEmpty { metric("总里程", value: distance) }
                }
            }
            Spacer(minLength: 2)
            actions
        }
        .foregroundStyle(ink)
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
