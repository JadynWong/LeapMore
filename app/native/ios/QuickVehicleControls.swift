import AppIntents
import SwiftUI
import WidgetKit

@available(iOSApplicationExtension 18.0, *)
struct PrepareVehicleControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: "com.leapmore.prepare", intent: QuickPresetConfiguration.self) { configuration in
            ControlWidgetButton(action: DirectVehicleIntent(.prepare, configuration.preset?.id)) {
                Label(configuration.preset?.name ?? "一键备车", systemImage: "sparkles")
            } actionLabel: { _ in
                Text(QuickControlFeedback.label(.prepare, configuration.preset?.id) ?? "一键备车")
            }
        }
        .promptsForUserConfiguration()
        .displayName("一键备车")
        .description("选择车辆和备车预设。")
    }
}

@available(iOSApplicationExtension 18.0, *)
@MainActor
private func vehicleButton(_ action: QuickVehicleAction, _ title: LocalizedStringResource, _ symbol: String) -> some ControlWidgetConfiguration {
    AppIntentControlConfiguration(kind: "com.leapmore." + action.rawValue, intent: QuickVehicleConfiguration.self) { configuration in
        ControlWidgetButton(action: DirectVehicleIntent(action, configuration.vehicle?.id)) {
            Label { Text(title) } icon: { Image(systemName: symbol) }
        } actionLabel: { _ in
            Text(QuickControlFeedback.label(action, configuration.vehicle?.id) ?? configuration.vehicle?.name ?? "选择车辆")
        }
    }
    .promptsForUserConfiguration()
    .displayName(title)
    .description("对绑定的车辆执行此操作。")
}

@available(iOSApplicationExtension 18.0, *)
struct StartClimateControl: ControlWidget {
    var body: some ControlWidgetConfiguration { vehicleButton(.climateOn, "开启空调", "fan.fill") }
}

@available(iOSApplicationExtension 18.0, *)
struct StopClimateControl: ControlWidget {
    var body: some ControlWidgetConfiguration { vehicleButton(.climateOff, "关闭空调", "power") }
}

@available(iOSApplicationExtension 18.0, *)
struct LockVehicleControl: ControlWidget {
    var body: some ControlWidgetConfiguration { vehicleButton(.lock, "锁车", "lock.fill") }
}

@available(iOSApplicationExtension 18.0, *)
struct FindVehicleControl: ControlWidget {
    var body: some ControlWidgetConfiguration { vehicleButton(.find, "鸣笛寻车", "speaker.wave.2.fill") }
}
