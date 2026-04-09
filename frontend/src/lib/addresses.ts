/**
 * Load contract addresses from the most recent deployment in deployed-addresses.json.
 *
 * In production this would be fetched or bundled at build time.
 * For local development, the JSON is copied into the frontend after deploying.
 *
 * Usage:
 *   import { ADDRESSES, getLatestDeployment } from '../lib/addresses';
 *   console.log(ADDRESSES.pmAMM); // "0x..."
 */

// This file is copied from the project root after `npx hardhat run scripts/deploy.js`
// If it doesn't exist yet, provide empty defaults so the app at least loads.
import type { Address } from "viem";
import deployedJson from "../../deployed-addresses.json";

export interface DeploymentRecord {
  network: string;
  chainId: number;
  timestamp: string;
  addresses: {
    CollateralToken: string;
    Oracle: string;
    pmAMM: string;
    ForecasterReputation: string;
    ResolutionCouncil: string;
    MarketFactory: string;
    PositionVault: string;
  };
}

const deployments: DeploymentRecord[] = deployedJson as DeploymentRecord[];

export function getLatestDeployment(): DeploymentRecord | null {
  if (deployments.length === 0) return null;
  return deployments[deployments.length - 1];
}

const latest = getLatestDeployment();

const EMPTY: Record<string, Address> = {
  CollateralToken: "0x0000000000000000000000000000000000000000",
  Oracle: "0x0000000000000000000000000000000000000000",
  pmAMM: "0x0000000000000000000000000000000000000000",
  ForecasterReputation: "0x0000000000000000000000000000000000000000",
  ResolutionCouncil: "0x0000000000000000000000000000000000000000",
  MarketFactory: "0x0000000000000000000000000000000000000000",
  PositionVault: "0x0000000000000000000000000000000000000000",
};

export const ADDRESSES = (
  latest
    ? Object.fromEntries(
        Object.entries(latest.addresses).map(([k, v]) => [k, v as Address])
      )
    : EMPTY
) as Record<keyof DeploymentRecord["addresses"], Address>;
