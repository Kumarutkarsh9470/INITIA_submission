/**
 * useMarket — fetches all data for a single prediction market.
 *
 * Usage:
 *   const { question, price, state, isLoading, refetch } = useMarket(0n);
 */

import { useState, useEffect, useCallback } from "react";
import { formatEther, type Address } from "viem";
import { publicClient } from "./useContracts";
import { ADDRESSES } from "../lib/addresses";
import { MarketFactoryABI, pmAMMABI } from "../lib/abis";

export interface MarketData {
  question: string;
  outcomes: string[];
  expiryBlock: bigint;
  creator: Address;
  resolutionType: number;
  category: number;
  state: number;
  oraclePairId: string;
  oracleThreshold: bigint;
  creatorBond: bigint;
  creatorDeadline: bigint;
  // pmAMM data
  price: bigint; // YES probability in WAD
  priceFormatted: string;
  reserveYes: bigint;
  reserveNo: bigint;
  settled: boolean;
  outcome: number;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMarket(marketId: bigint): MarketData {
  const [data, setData] = useState<Partial<MarketData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch factory market metadata (getMarket includes outcomes)
      const meta = (await publicClient.readContract({
        address: ADDRESSES.MarketFactory,
        abi: MarketFactoryABI,
        functionName: "getMarket",
        args: [marketId],
      })) as [string, string[], bigint, Address, number, number, number, string, bigint, bigint, bigint];

      // Fetch current price from pmAMM (may fail for uninitialized markets)
      let price = 0n;
      try {
        price = (await publicClient.readContract({
          address: ADDRESSES.pmAMM,
          abi: pmAMMABI,
          functionName: "currentPrice",
          args: [marketId],
        })) as bigint;
      } catch { /* market may not be initialized in AMM */ }

      // Fetch pmAMM market data
      let ammData: [bigint, bigint, bigint, bigint, bigint, bigint, boolean, number, Address] = [0n, 0n, 0n, 0n, 0n, 0n, false, 0, "0x0000000000000000000000000000000000000000"];
      try {
        ammData = (await publicClient.readContract({
          address: ADDRESSES.pmAMM,
          abi: pmAMMABI,
          functionName: "markets",
          args: [marketId],
        })) as [bigint, bigint, bigint, bigint, bigint, bigint, boolean, number, Address];
      } catch { /* market may not be initialized in AMM */ }

      setData({
        question: meta[0],
        outcomes: meta[1],
        expiryBlock: meta[2],
        creator: meta[3],
        resolutionType: Number(meta[4]),
        category: Number(meta[5]),
        state: Number(meta[6]),
        oraclePairId: meta[7],
        oracleThreshold: meta[8],
        creatorBond: meta[9],
        creatorDeadline: meta[10],
        price,
        priceFormatted: (Number(formatEther(price)) * 100).toFixed(1),
        reserveYes: ammData[0],
        reserveNo: ammData[1],
        settled: ammData[6],
        outcome: Number(ammData[7]),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch market data");
    } finally {
      setIsLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    question: data.question ?? "",
    outcomes: data.outcomes ?? ["YES", "NO"],
    expiryBlock: data.expiryBlock ?? 0n,
    creator: data.creator ?? ("0x0" as Address),
    resolutionType: data.resolutionType ?? 0,
    category: data.category ?? 0,
    state: data.state ?? 0,
    oraclePairId: data.oraclePairId ?? "",
    oracleThreshold: data.oracleThreshold ?? 0n,
    creatorBond: data.creatorBond ?? 0n,
    creatorDeadline: data.creatorDeadline ?? 0n,
    price: data.price ?? 0n,
    priceFormatted: data.priceFormatted ?? "0.0",
    reserveYes: data.reserveYes ?? 0n,
    reserveNo: data.reserveNo ?? 0n,
    settled: data.settled ?? false,
    outcome: data.outcome ?? 0,
    isLoading,
    error,
    refetch: fetchData,
  };
}
