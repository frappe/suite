import Foundation

public struct SocketIOEvent: Equatable, Sendable {
	public let name: String
	public let payload: Data

	public init(name: String, payload: Data) {
		self.name = name
		self.payload = payload
	}
}

public enum SocketIOFrame {
	public static func event(from text: String) -> SocketIOEvent? {
		guard text.hasPrefix("42") else { return nil }
		let body = String(text.dropFirst(2))
		guard
			let data = body.data(using: .utf8),
			let array = try? JSONSerialization.jsonObject(with: data) as? [Any],
			array.count >= 2,
			let name = array.first as? String,
			JSONSerialization.isValidJSONObject(array[1]),
			let payload = try? JSONSerialization.data(withJSONObject: array[1])
		else {
			return nil
		}
		return SocketIOEvent(name: name, payload: payload)
	}

	public static func connectPacket(grant: String) throws -> String {
		let payload = try JSONSerialization.data(withJSONObject: ["token": grant])
		guard let json = String(data: payload, encoding: .utf8) else {
			throw SocketIOFrameError.invalidEncoding
		}
		return "40\(json)"
	}
}

public enum SocketIOFrameError: Error {
	case invalidEncoding
}
