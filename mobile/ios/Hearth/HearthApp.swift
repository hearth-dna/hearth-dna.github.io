import SwiftUI

/// The iOS app (ADR 0010): a SwiftUI app with its own database; everything starts in
/// `NativeRootView` (Native/UI/HealthStore.swift).
@main
struct HearthApp: App {
    var body: some Scene {
        WindowGroup {
            NativeRootView()
        }
    }
}
