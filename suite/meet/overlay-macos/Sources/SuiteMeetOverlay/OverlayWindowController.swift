import AppKit
import SuiteMeetOverlayCore

final class OverlayWindowController {
	let view: OverlayView
	private let panel: NSPanel

	init(board: AnnotationBoard, configuration: LaunchConfiguration) {
		let screen = Self.selectScreen(for: configuration)
		view = OverlayView(board: board)
		panel = NSPanel(
			contentRect: screen.frame,
			styleMask: [.borderless, .nonactivatingPanel],
			backing: .buffered,
			defer: false,
			screen: screen
		)
		panel.contentView = view
		panel.backgroundColor = .clear
		panel.isOpaque = false
		panel.hasShadow = false
		panel.ignoresMouseEvents = true
		panel.hidesOnDeactivate = false
		panel.level = .screenSaver
		panel.collectionBehavior = [
			.canJoinAllSpaces,
			.fullScreenAuxiliary,
			.stationary,
			.ignoresCycle,
		]
		panel.sharingType = .none
		panel.setFrame(screen.frame, display: true)
	}

	func show() {
		panel.orderFrontRegardless()
	}

	func close() {
		panel.orderOut(nil)
		panel.close()
	}

	private static func selectScreen(for configuration: LaunchConfiguration) -> NSScreen {
		let screens = NSScreen.screens
		guard let fallback = NSScreen.main ?? screens.first else {
			fatalError("No display is available")
		}
		guard
			let width = configuration.captureWidth,
			let height = configuration.captureHeight
		else {
			return fallback
		}
		return screens.min { left, right in
			screenDistance(left, width: width, height: height) <
				screenDistance(right, width: width, height: height)
		} ?? fallback
	}

	private static func screenDistance(
		_ screen: NSScreen,
		width: Double,
		height: Double
	) -> Double {
		let pixelWidth = screen.frame.width * screen.backingScaleFactor
		let pixelHeight = screen.frame.height * screen.backingScaleFactor
		return abs(pixelWidth - width) + abs(pixelHeight - height)
	}
}
