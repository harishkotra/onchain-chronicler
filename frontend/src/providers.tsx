import { WagmiProvider, createConfig, http } from 'wagmi';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MantineProvider } from '@mantine/core';
import { defineChain } from 'viem';
import '@mantine/core/styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 3000, // Refetch every 3 seconds for fresh data
    },
  },
});

// Define the Somnia Testnet chain for Viem/Wagmi
export const somniaTestnet = defineChain({
  id: 50312,
  name: 'Somnia Shannon Testnet',
  nativeCurrency: { name: 'Somnia Test Token', symbol: 'STT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://dream-rpc.somnia.network/'] },
  },
  blockExplorers: {
    default: { name: 'Shannon Explorer', url: 'https://shannon-explorer.somnia.network' },
  },
});

const config = createConfig(
  getDefaultConfig({
    appName: 'Chronicle AI',
    chains: [somniaTestnet],
    walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID!,
    transports: {
      [somniaTestnet.id]: http('https://dream-rpc.somnia.network/', {
        timeout: 60_000,
        retryCount: 5,
        retryDelay: 1000,
      }),
    },
  })
);

export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">
          <MantineProvider defaultColorScheme="dark">{children}</MantineProvider>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};