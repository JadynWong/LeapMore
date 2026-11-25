import Foundation

enum LeapWidgetStorage {
    static let defaults: UserDefaults? = {
        let original = "group.com.leapmore.app"
        var candidates = [original]
        // SideStore appends the signing team's ID to both the app ID and the App Group.
        if let id = Bundle.main.bundleIdentifier {
            let appID = id.hasSuffix(".widget") ? String(id.dropLast(".widget".count)) : id
            if appID.hasPrefix("com.leapmore.app."), !appID.dropFirst("com.leapmore.app.".count).contains(".") {
                candidates.append("group." + appID)
            }
        }
        guard let group = candidates.first(where: {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil
        }) else { return nil }
        return UserDefaults(suiteName: group)
    }()
}
