import { type Socket } from "socket.io-client";

import { createSiteSocket } from "@/realtime";

let socket: Socket | null = null;

export function initSocket(): Socket {
	socket = createSiteSocket({ transports: ["websocket", "polling"] });
	return socket;
}

export function useSocket(): Socket | null {
	return socket;
}
