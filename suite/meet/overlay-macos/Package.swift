// swift-tools-version: 5.10

import PackageDescription

let package = Package(
	name: "SuiteMeetOverlay",
	platforms: [.macOS(.v13)],
	products: [
		.library(name: "SuiteMeetOverlayCore", targets: ["SuiteMeetOverlayCore"]),
		.executable(name: "SuiteMeetOverlay", targets: ["SuiteMeetOverlay"]),
		.executable(
			name: "SuiteMeetOverlayCoreChecks",
			targets: ["SuiteMeetOverlayCoreChecks"]
		),
	],
	targets: [
		.target(name: "SuiteMeetOverlayCore"),
		.executableTarget(
			name: "SuiteMeetOverlay",
			dependencies: ["SuiteMeetOverlayCore"]
		),
		.executableTarget(
			name: "SuiteMeetOverlayCoreChecks",
			dependencies: ["SuiteMeetOverlayCore"]
		),
	]
)
