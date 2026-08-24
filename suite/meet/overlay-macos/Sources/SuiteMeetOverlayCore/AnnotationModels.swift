import Foundation

public struct AnnotationPoint: Codable, Equatable, Sendable {
	public let x: Double
	public let y: Double
}

public enum AnnotationTool: String, Codable, Sendable {
	case pen
	case highlighter
	case eraser
}

public struct AnnotationStroke: Codable, Equatable, Sendable {
	public let id: String
	public let producerId: String
	public let authorId: String
	public let tool: AnnotationTool
	public let color: String
	public let width: Double
	public var points: [AnnotationPoint]
	public let createdAt: String
}

public struct AnnotationSnapshot: Codable, Equatable, Sendable {
	public let producerId: String
	public let presenterId: String
	public let participantsCanAnnotate: Bool
	public let strokes: [AnnotationStroke]
}

public struct AnnotationStrokeChunk: Codable, Equatable, Sendable {
	public let producerId: String
	public let strokeId: String
	public let phase: String
	public let tool: AnnotationTool?
	public let color: String?
	public let width: Double?
	public let points: [AnnotationPoint]
	public let authorId: String?
	public let timestamp: String?
}

public struct AnnotationAction: Codable, Equatable, Sendable {
	public let producerId: String
	public let action: String
	public let strokeId: String?
}

public struct AnnotationLaser: Codable, Equatable, Sendable {
	public let producerId: String
	public let participantId: String
	public let points: [AnnotationPoint]
	public let active: Bool
}

public struct AnnotationBoardClosed: Codable, Equatable, Sendable {
	public let producerId: String
}

public struct AnnotationBoard: Equatable, Sendable {
	public private(set) var producerID: String
	public private(set) var strokes: [AnnotationStroke] = []

	public init(producerID: String) {
		self.producerID = producerID
	}

	public mutating func apply(snapshot: AnnotationSnapshot) {
		guard snapshot.producerId == producerID else { return }
		strokes = snapshot.strokes
	}

	public mutating func apply(chunk: AnnotationStrokeChunk) {
		guard chunk.producerId == producerID else { return }
		if chunk.phase == "start" {
			guard
				let tool = chunk.tool,
				let color = chunk.color,
				let width = chunk.width,
				let authorID = chunk.authorId,
				let timestamp = chunk.timestamp,
				!strokes.contains(where: { $0.id == chunk.strokeId })
			else {
				return
			}
			strokes.append(
				AnnotationStroke(
					id: chunk.strokeId,
					producerId: chunk.producerId,
					authorId: authorID,
					tool: tool,
					color: color,
					width: width,
					points: chunk.points,
					createdAt: timestamp
				)
			)
			return
		}
		guard let index = strokes.firstIndex(where: { $0.id == chunk.strokeId }) else {
			return
		}
		strokes[index].points.append(contentsOf: chunk.points)
	}

	public mutating func apply(action: AnnotationAction) {
		guard action.producerId == producerID else { return }
		if action.action == "clear" {
			strokes.removeAll()
		} else if action.action == "undo", let strokeID = action.strokeId {
			strokes.removeAll { $0.id == strokeID }
		}
	}
}
