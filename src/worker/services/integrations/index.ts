import type { SourcePlatformId } from "@shared/constants";
import type { ProviderAdapter } from "./types";
import { devpostAdapter } from "./devpost";
import { machinehackAdapter } from "./machinehack";
import { mlhAdapter } from "./mlh";
import { unstopAdapter } from "./unstop";

export const PROVIDERS: Record<SourcePlatformId, ProviderAdapter> = {
	devpost: devpostAdapter,
	machinehack: machinehackAdapter,
	mlh: mlhAdapter,
	unstop: unstopAdapter,
};

export function getProvider(id: string): ProviderAdapter | null {
	return (PROVIDERS as Record<string, ProviderAdapter>)[id] ?? null;
}
