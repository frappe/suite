// The Drive e2e helpers import the generated client types from
// `frontend/src/apps/drive/client/generated.ts`. That file reaches the platform
// transport module, which uses two ambient declarations the frontend gets from
// its own `src/env.d.ts`. They are repeated here so the e2e program typechecks
// on its own.
interface ImportMetaEnv {
	readonly DEV: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	csrf_token?: string;
}
