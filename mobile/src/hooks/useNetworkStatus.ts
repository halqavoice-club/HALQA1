import { useEffect, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export function useNetworkStatus() {
  const [status, setStatus] = useState({
    isConnected: true,
    isInternetReachable: true,
    networkType: 'unknown' as string,
  });

  useEffect(() => {
    let mounted = true;

    const setCurrentStatus = (state: NetInfoState) => {
      if (!mounted) return;
      setStatus({
        isConnected: Boolean(state.isConnected),
        isInternetReachable: Boolean(state.isInternetReachable),
        networkType: state.type ?? 'unknown',
      });
    };

    const unsubscribe = NetInfo.addEventListener(setCurrentStatus);
    NetInfo.fetch().then(setCurrentStatus).catch(() => {
      if (!mounted) return;
      setStatus({ isConnected: false, isInternetReachable: false, networkType: 'unknown' });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return status;
}
