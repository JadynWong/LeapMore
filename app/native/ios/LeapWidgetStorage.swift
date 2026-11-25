import Foundation

enum LeapWidgetStorage {
    static let defaults: UserDefaults? = {
        let original = "group.com.leapmore.app"
        var candidates = [original]
        // SideStore appends the signing team's ID to both the app ID and the App Group.
        // Read the containing app's ID in the extension too. Re-signers may rename the extension independently.
        let bundle = Bundle.main.bundleURL
        let app = bundle.pathExtension == "appex" ? Bundle(url: bundle.deletingLastPathComponent().deletingLastPathComponent()) : Bundle.main
        if let id = app?.bundleIdentifier, "group." + id != original {
            candidates.append("group." + id)
        }
        guard let group = candidates.first(where: {
            FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) != nil
        }) else { return nil }
        return UserDefaults(suiteName: group)
    }()
}
