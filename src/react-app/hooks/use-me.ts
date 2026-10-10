import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@/services/system";
import { getMe } from "@/services/personal";

export function useMe() {
	const q = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 60_000 });
	return { ...q, user: q.data ?? null, isAdmin: q.data?.role === "admin" };
}

export function useAppConfig() {
	return useQuery({ queryKey: ["config"], queryFn: getConfig, staleTime: 5 * 60_000 });
}
