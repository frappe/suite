import Foundation

public struct LaunchConfiguration: Equatable, Sendable {
	public let origin: URL
	public let socketPath: String
	public let grant: String
	public let producerID: String
	public let captureWidth: Double?
	public let captureHeight: Double?
	public let displaySurface: String?

	public init(url: URL) throws {
		guard url.scheme == "frappe-meet-overlay", url.host == "start" else {
			throw LaunchConfigurationError.invalidAction
		}
		guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
			throw LaunchConfigurationError.invalidURL
		}
		let values = Dictionary(
			uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
				item.value.map { (item.name, $0) }
			}
		)
		guard
			let originValue = values["origin"],
			let origin = URL(string: originValue),
			origin.scheme == "http" || origin.scheme == "https"
		else {
			throw LaunchConfigurationError.invalidOrigin
		}
		guard let grant = values["grant"], !grant.isEmpty, grant.count <= 8_192 else {
			throw LaunchConfigurationError.invalidGrant
		}
		guard
			let producerID = values["producerId"],
			producerID.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
		else {
			throw LaunchConfigurationError.invalidProducer
		}

		self.origin = origin
		self.socketPath = Self.normalizeSocketPath(values["socketPath"] ?? "/socket.io/")
		self.grant = grant
		self.producerID = producerID
		self.captureWidth = Self.dimension(values["captureWidth"])
		self.captureHeight = Self.dimension(values["captureHeight"])
		self.displaySurface = values["displaySurface"]
	}

	public var webSocketURL: URL {
		get throws {
			guard var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else {
				throw LaunchConfigurationError.invalidOrigin
			}
			components.scheme = origin.scheme == "https" ? "wss" : "ws"
			components.path = socketPath
			components.queryItems = [
				URLQueryItem(name: "EIO", value: "4"),
				URLQueryItem(name: "transport", value: "websocket"),
			]
			guard let result = components.url else {
				throw LaunchConfigurationError.invalidURL
			}
			return result
		}
	}

	private static func normalizeSocketPath(_ value: String) -> String {
		let leading = value.hasPrefix("/") ? value : "/\(value)"
		return leading.hasSuffix("/") ? leading : "\(leading)/"
	}

	private static func dimension(_ value: String?) -> Double? {
		guard let value, let number = Double(value), number > 0, number <= 32_768 else {
			return nil
		}
		return number
	}
}

public enum LaunchConfigurationError: Error, Equatable {
	case invalidAction
	case invalidURL
	case invalidOrigin
	case invalidGrant
	case invalidProducer
}
