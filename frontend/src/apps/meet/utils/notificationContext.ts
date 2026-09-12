/**
 * Notification Context Manager
 * Determines when to play notification sounds based on user context
 */

interface NotificationContext {
	isTabVisible: boolean;
	isChatOpen: boolean;
	isScreenSharing: boolean;
	lastNotificationTime: Record<string, number>;
	playedNotificationsWhenHidden: Record<string, boolean>;
	joinedUsers: Set<string>;
}

class NotificationContextManager {
	private context: NotificationContext = {
		isTabVisible: true,
		isChatOpen: false,
		isScreenSharing: false,
		lastNotificationTime: {},
		playedNotificationsWhenHidden: {},
		joinedUsers: new Set(),
	};

	private readonly MIN_NOTIFICATION_INTERVAL = 5000; // 5 seconds between same type

	constructor() {
		this.setupVisibilityListener();
	}

	private setupVisibilityListener() {
		document.addEventListener("visibilitychange", () => {
			const wasHidden = !this.context.isTabVisible;
			this.context.isTabVisible = !document.hidden;

			if (this.context.isTabVisible && wasHidden) {
				this.context.playedNotificationsWhenHidden = {};
			}
		});
		window.addEventListener("focus", () => {
			const wasHidden = !this.context.isTabVisible;
			this.context.isTabVisible = true;

			if (wasHidden) {
				this.context.playedNotificationsWhenHidden = {};
			}
		});
		window.addEventListener("blur", () => {
			this.context.isTabVisible = false;
		});
	}

	updateChatState(isOpen: boolean) {
		this.context.isChatOpen = isOpen;
	}

	updateScreenShareState(isSharing: boolean) {
		this.context.isScreenSharing = isSharing;
	}

	resetJoinedUsers() {
		this.context.joinedUsers.clear();
	}

	shouldPlayNotification(
		type: "join" | "leave" | "chat" | "joinRequest" | "raiseHand",
		options?: { isLocalUser?: boolean; userId?: string },
	): boolean {
		const now = Date.now();

		// If tab is not visible, only play each notification type once
		if (!this.context.isTabVisible) {
			if (this.context.playedNotificationsWhenHidden[type]) {
				return false;
			}
		}

		const lastTime = this.context.lastNotificationTime[type] || 0;
		if (now - lastTime < this.MIN_NOTIFICATION_INTERVAL) {
			return false;
		}

		// only play for local user leaving
		if (type === "leave" && !options?.isLocalUser) {
			return false;
		}

		// suppress join noise when screen sharing
		if (type === "join") {
			if (this.context.isScreenSharing) {
				return false;
			}

			const userId = options?.userId;
			if (userId && this.context.joinedUsers.has(userId)) {
				return false;
			}

			if (userId) {
				this.context.joinedUsers.add(userId);
			}
		}

		// suppress chat sounds when chat is open
		if (type === "chat" && this.context.isChatOpen) {
			return false;
		}

		this.context.lastNotificationTime[type] = now;
		if (!this.context.isTabVisible) {
			this.context.playedNotificationsWhenHidden[type] = true;
		}
		return true;
	}
}

const notificationContextManager = new NotificationContextManager();

export default notificationContextManager;
