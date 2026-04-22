import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as authService from "../services/authService";

import { ApiError } from "@/shared/api/apiClient";
import { queryKeys } from "@/shared/constants/queryKeys";


export function useAuthMe() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: async () => {
      try {
        const response = await authService.getMe();
        return response.data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function useAuthActions() {
  const queryClient = useQueryClient();

  const loginMutation = useMutation({
    mutationFn: (payload) => authService.login(payload),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.auth.me, response.data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => authService.logout(),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, null);
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: (payload) => authService.changePassword(payload),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.auth.me, response.data);
    },
  });

  return {
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    changePassword: changePasswordMutation.mutateAsync,
    loginError: loginMutation.error,
    changePasswordError: changePasswordMutation.error,
    isLoggingIn: loginMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
    isChangingPassword: changePasswordMutation.isPending,
  };
}
