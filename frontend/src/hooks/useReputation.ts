/**
 * useReputation — fetches a user's ForecasterReputation data.
 *
 * Usage:
 *   const { score, isEligibleResolver, ltv, bondWaived } = useReputation(address);
 */

import { useState, useEffect, useCallback } from "react";
import type { Address } from "viem";
import { publicClient } from "./useContracts";
import { ADDRESSES } from "../lib/addresses";
import { ForecasterReputationABI } from "../lib/abis";

export interface ReputationData {
  totalPredictions: bigint;
  correctPredictions: bigint;
  totalVolume: bigint;
  lastActiveBlock: bigint;
  score: bigint;
  isEligibleResolver: boolean;
  ltv: bigint;
  bondWaived: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReputation(userAddress: Address | null): ReputationData {
  const [data, setData] = useState<Partial<ReputationData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!userAddress) {
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);

      const [forecaster, score, isEligible, ltv, waived] = await Promise.all([
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "forecasters",
          args: [userAddress],
        }) as Promise<[bigint, bigint, bigint, bigint, bigint]>,
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "getScore",
          args: [userAddress],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "isEligibleResolver",
          args: [userAddress],
        }) as Promise<boolean>,
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "getLTV",
          args: [userAddress],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: ADDRESSES.ForecasterReputation,
          abi: ForecasterReputationABI,
          functionName: "bondWaived",
          args: [userAddress],
        }) as Promise<boolean>,
      ]);

      setData({
        totalPredictions: forecaster[0],
        correctPredictions: forecaster[1],
        totalVolume: forecaster[2],
        lastActiveBlock: forecaster[3],
        score,
        isEligibleResolver: isEligible,
        ltv,
        bondWaived: waived,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch reputation");
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    totalPredictions: data.totalPredictions ?? 0n,
    correctPredictions: data.correctPredictions ?? 0n,
    totalVolume: data.totalVolume ?? 0n,
    lastActiveBlock: data.lastActiveBlock ?? 0n,
    score: data.score ?? 0n,
    isEligibleResolver: data.isEligibleResolver ?? false,
    ltv: data.ltv ?? 50n,
    bondWaived: data.bondWaived ?? false,
    isLoading,
    error,
    refetch: fetchData,
  };
}
