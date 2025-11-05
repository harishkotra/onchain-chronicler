import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Container, Stack, Paper, Title, TextInput, Button, Text, Table, Group, Box, Badge, Divider, Anchor, Loader, Center } from '@mantine/core';
import abi from './abi/ChronicleRegistry.json';

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}`;

interface LeaderboardEntry {
  address: string;
  points: number;
}

interface Chronicle {
  txHash: string;
  narrative: string;
  requester: string;
  timestamp: number;
}

type View = 'home' | 'chronicles';

function App() {
  const { address } = useAccount();
  const [view, setView] = useState<View>('home');
  const [txHash, setTxHash] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [status, setStatus] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userPoints, setUserPoints] = useState(0);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [chronicles, setChronicles] = useState<Chronicle[]>([]);
  const [totalChronicles, setTotalChronicles] = useState(0);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(true);
  const [isLoadingChronicles, setIsLoadingChronicles] = useState(true);

  // Get submission fee from contract
  const { data: submissionFee } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: abi,
    functionName: 'submissionFee',
  });

  // Get user points from contract
  const { data: contractUserPoints } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: abi,
    functionName: 'userPoints',
    args: address ? [address] : undefined,
  });

  // Update user points when data changes
  useEffect(() => {
    if (contractUserPoints) {
      setUserPoints(Number(contractUserPoints));
    }
  }, [contractUserPoints]);

  // Fetch leaderboard and chronicles on mount
  useEffect(() => {
    fetchLeaderboard();
    fetchChronicles();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      setIsLoadingLeaderboard(true);
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/leaderboard`);
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data.leaderboard || []);
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  const fetchChronicles = async () => {
    try {
      setIsLoadingChronicles(true);
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/chronicles`);
      if (response.ok) {
        const data = await response.json();
        setChronicles(data.chronicles || []);
        setTotalChronicles(data.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch chronicles:', error);
    } finally {
      setIsLoadingChronicles(false);
    }
  };

  // Contract write hook for requesting chronicle
  const { writeContract, data: requestHash, isPending: isRequestPending, error: writeError } = useWriteContract();

  // Log write errors
  useEffect(() => {
    if (writeError) {
      console.error('[Error] Transaction failed:', writeError.message);
      setStatus('Transaction failed: ' + writeError.message);
      setIsLoading(false);
    }
  }, [writeError]);

  // Wait for request transaction to be confirmed
  const {
    isLoading: isConfirming,
    isSuccess: isRequestConfirmed,
    isError: isConfirmError,
    error: confirmError
  } = useWaitForTransactionReceipt({
    hash: requestHash,
    confirmations: 1,
    pollingInterval: 1000, // Poll every second
  });

  // Update status when confirming and set fallback timeout
  useEffect(() => {
    if (isConfirming) {
      setStatus('Waiting for transaction confirmation...');

      // Fallback: if confirmation takes too long (45 seconds), proceed anyway
      // Backend will wait for pending request to exist before analyzing
      const fallbackTimer = setTimeout(() => {
        if (!isRequestConfirmed && txHash && !hasAnalyzed) {
          setStatus('Confirmation taking longer than expected. Backend will wait for on-chain confirmation...');
          analyzeWithBackend();
        }
      }, 45000); // 45 second fallback (backend waits up to 2 minutes)

      return () => clearTimeout(fallbackTimer);
    }
  }, [isConfirming, isRequestConfirmed, txHash, hasAnalyzed]);

  // Handle confirmation errors
  useEffect(() => {
    if (isConfirmError && !hasAnalyzed) {
      console.error('[Error] Transaction confirmation failed');
      setStatus('Transaction confirmation issue. Proceeding with analysis...');
      // Try to analyze even if confirmation has errors
      if (txHash) {
        setTimeout(() => analyzeWithBackend(), 2000);
      }
    }
  }, [isConfirmError, confirmError, txHash, hasAnalyzed]);

  // When request is confirmed, call backend to analyze
  useEffect(() => {
    if (isRequestConfirmed && txHash && !hasAnalyzed) {
      analyzeWithBackend();
    }
  }, [isRequestConfirmed, txHash, hasAnalyzed]);

  const analyzeWithBackend = async () => {
    if (hasAnalyzed) return;

    setHasAnalyzed(true);
    setStatus('Waiting for your request to be confirmed on-chain, then analyzing with AI...');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/analyze-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'PENDING_REQUEST_NOT_FOUND') {
          throw new Error('Your chronicle request transaction was not confirmed. Please try again.');
        }
        throw new Error(data.message || 'Failed to analyze transaction');
      }

      setNarrative(data.narrative);
      setStatus('Analysis complete!');
      // Refresh leaderboard and chronicles after successful analysis
      setTimeout(() => {
        fetchLeaderboard();
        fetchChronicles();
      }, 2000);
    } catch (error: any) {
      console.error('[Error] Analysis failed:', error.message);
      setNarrative(error.message || 'An error occurred during analysis.');
      setStatus('Error during analysis');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!address) {
      setNarrative('Please connect your wallet first.');
      return;
    }

    if (!txHash || txHash.length !== 66) {
      setNarrative('Please enter a valid transaction hash.');
      return;
    }

    // Reset state for new analysis
    setIsLoading(true);
    setNarrative('');
    setStatus('Checking contract state...');
    setHasAnalyzed(false);

    try {
      // Check if chronicle already exists or request is pending
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/check-chronicle-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      });

      const statusData = await response.json();

      if (statusData.chronicleExists) {
        setNarrative(statusData.chronicle);
        setStatus('✓ Chronicle retrieved from blockchain (already exists)');
        setIsLoading(false);
        return;
      }

      if (statusData.requestPending) {
        setNarrative('A request is already pending for this transaction. Please wait for AI analysis.');
        setStatus('Request already pending');
        setIsLoading(false);
        return;
      }

      setStatus('Requesting chronicle from contract...');

      // Step 1: Request chronicle from contract (creates pending request)
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: abi,
        functionName: 'requestChronicle',
        args: [txHash as `0x${string}`],
        value: submissionFee as bigint,
      });
    } catch (error: any) {
      console.error('[Error] Failed to analyze:', error.message);
      setNarrative('Failed to submit request to contract.');
      setIsLoading(false);
      setStatus('');
    }
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const isCurrentUser = (addr: string) => address && addr.toLowerCase() === address.toLowerCase();

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Box style={{ minHeight: '100vh', backgroundColor: '#000', color: '#fff' }}>
      <Container size="xl" py={60}>
        <Stack gap={50}>
          {/* Header */}
          <Box>
            <Group justify="space-between" align="center" mb="md">
              <Box>
                <Title order={1} size={48} fw={700} c="#fff" mb={8}>
                  Chronicle AI
                </Title>
                <Text size="lg" c="gray.5" fw={400}>
                  Transform blockchain data into narratives
                </Text>
              </Box>
              <Box>
                <ConnectKitButton />
              </Box>
            </Group>
            <Group gap="lg" mt="md">
              {address && userPoints > 0 && (
                <Badge size="xl" radius="md" variant="light" color="gray" style={{ fontSize: '16px', padding: '12px 20px' }}>
                  Your Points: {userPoints}
                </Badge>
              )}
              <Badge size="xl" radius="md" variant="light" color="blue" style={{ fontSize: '16px', padding: '12px 20px' }}>
                Total Chronicles: {isLoadingChronicles ? <Loader size="xs" color="blue" /> : totalChronicles}
              </Badge>
            </Group>
            {/* Navigation */}
            <Group gap="md" mt="xl">
              <Button
                variant={view === 'home' ? 'filled' : 'outline'}
                color="gray"
                onClick={() => setView('home')}
                style={{ backgroundColor: view === 'home' ? '#fff' : 'transparent', color: view === 'home' ? '#000' : '#fff' }}
              >
                Analyze
              </Button>
              <Button
                variant={view === 'chronicles' ? 'filled' : 'outline'}
                color="gray"
                onClick={() => setView('chronicles')}
                style={{ backgroundColor: view === 'chronicles' ? '#fff' : 'transparent', color: view === 'chronicles' ? '#000' : '#fff' }}
              >
                All Chronicles ({isLoadingChronicles ? '...' : totalChronicles})
              </Button>
            </Group>
          </Box>

          {/* Home View - Analyzer and Leaderboard */}
          {view === 'home' && (
            <>
              {/* Main Analyzer Section */}
              <Paper
            p={40}
            radius="lg"
            style={{
              backgroundColor: '#111',
              border: '1px solid #222',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}
          >
            <Stack gap="lg">
              <Box>
                <Title order={2} size={28} fw={600} c="#fff" mb={8}>
                  Analyze Transaction
                </Title>
                <Text size="md" c="gray.6">
                  Submit a Somnia transaction hash for AI-powered analysis
                </Text>
              </Box>

              <Divider color="#222" />

              <Box>
                <Text size="sm" c="gray.5" mb={12} fw={500}>
                  Analysis Fee: {submissionFee ? `${Number(submissionFee) / 1e18} STT` : 'Loading...'}
                </Text>
                <Group align="flex-start" gap="md">
                  <TextInput
                    size="lg"
                    placeholder="0x..."
                    value={txHash}
                    onChange={(event) => setTxHash(event.currentTarget.value)}
                    disabled={isLoading}
                    style={{ flex: 1 }}
                    styles={{
                      input: {
                        backgroundColor: '#0a0a0a',
                        border: '1px solid #333',
                        color: '#fff',
                        fontFamily: 'monospace',
                        fontSize: '16px',
                        '&:focus': {
                          borderColor: '#555'
                        },
                        '&::placeholder': {
                          color: '#555'
                        }
                      }
                    }}
                  />
                  <Button
                    size="lg"
                    onClick={handleAnalyze}
                    loading={isLoading || isRequestPending || isConfirming}
                    disabled={!address}
                    style={{
                      backgroundColor: '#fff',
                      color: '#000',
                      fontWeight: 600,
                      minWidth: '140px',
                      height: '48px'
                    }}
                    styles={{
                      root: {
                        '&:hover': {
                          backgroundColor: '#e0e0e0'
                        }
                      }
                    }}
                  >
                    Analyze
                  </Button>
                </Group>
                {status && (
                  <Box mt="md">
                    <Text size="sm" c="gray.5" fw={500}>
                      {status}
                    </Text>
                    {requestHash && isConfirming && (
                      <Text size="xs" c="gray.6" mt="xs" ff="monospace">
                        Request TX: {requestHash.slice(0, 10)}...{requestHash.slice(-8)}
                      </Text>
                    )}
                  </Box>
                )}
              </Box>

              {narrative && (
                <>
                  <Divider color="#222" />
                  <Box>
                    <Group justify="space-between" align="center" mb="md">
                      <Title order={3} size={20} fw={600} c="#fff">
                        {status.includes('already exists') ? 'Existing Chronicle' : 'Analysis Result'}
                      </Title>
                      <Badge
                        size="md"
                        color={status.includes('already exists') ? 'blue' : 'gray'}
                        variant="light"
                      >
                        {status.includes('already exists') ? 'From Blockchain' : 'Complete'}
                      </Badge>
                    </Group>
                    <Text size="xs" c="gray.6" mb="md" ff="monospace">
                      {txHash}
                    </Text>
                    <Text size="md" c="gray.3" style={{ lineHeight: 1.7 }}>
                      {narrative}
                    </Text>
                  </Box>
                </>
              )}
            </Stack>
          </Paper>

          {/* Leaderboard Section */}
          <Paper
            p={40}
            radius="lg"
            style={{
              backgroundColor: '#111',
              border: '1px solid #222',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}
          >
            <Stack gap="lg">
              <Box>
                <Title order={2} size={28} fw={600} c="#fff" mb={8}>
                  Top Contributors
                </Title>
                <Text size="md" c="gray.6">
                  Users earn points by submitting transactions for analysis
                </Text>
              </Box>

              <Divider color="#222" />

              {isLoadingLeaderboard ? (
                <Center py={60}>
                  <Loader size="lg" color="gray" />
                </Center>
              ) : leaderboard.length > 0 ? (
                <Table
                  horizontalSpacing="xl"
                  verticalSpacing="md"
                  styles={{
                    table: {
                      backgroundColor: 'transparent'
                    }
                  }}
                >
                  <Table.Thead>
                    <Table.Tr style={{ borderBottom: '1px solid #222' }}>
                      <Table.Th style={{ color: '#888', fontWeight: 600, fontSize: '14px', padding: '16px 0' }}>
                        Rank
                      </Table.Th>
                      <Table.Th style={{ color: '#888', fontWeight: 600, fontSize: '14px' }}>
                        Address
                      </Table.Th>
                      <Table.Th style={{ color: '#888', fontWeight: 600, fontSize: '14px', textAlign: 'right' }}>
                        Points
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {leaderboard.map((item, index) => (
                      <Table.Tr
                        key={item.address}
                        style={{
                          borderBottom: '1px solid #1a1a1a',
                          backgroundColor: isCurrentUser(item.address) ? '#1a1a1a' : 'transparent'
                        }}
                      >
                        <Table.Td style={{ padding: '20px 0' }}>
                          <Badge
                            size="lg"
                            radius="md"
                            variant="light"
                            color={index === 0 ? 'yellow' : index === 1 ? 'gray' : index === 2 ? 'orange' : 'dark'}
                            style={{ fontSize: '14px', fontWeight: 700 }}
                          >
                            #{index + 1}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Text
                              ff="monospace"
                              c={isCurrentUser(item.address) ? '#fff' : 'gray.4'}
                              fw={isCurrentUser(item.address) ? 600 : 400}
                              size="md"
                              component="span"
                            >
                              {formatAddress(item.address)}
                            </Text>
                            {isCurrentUser(item.address) && (
                              <Badge size="sm" variant="light" color="gray">
                                You
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          <Text size="lg" fw={700} c="#fff">
                            {item.points}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Box py={40} style={{ textAlign: 'center' }}>
                  <Text size="md" c="gray.6">
                    No data yet. Be the first to submit a transaction!
                  </Text>
                </Box>
              )}
            </Stack>
          </Paper>
            </>
          )}

          {/* Chronicles View - All Analyzed Transactions */}
          {view === 'chronicles' && (
            <Paper
              p={40}
              radius="lg"
              style={{
                backgroundColor: '#111',
                border: '1px solid #222',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
              }}
            >
              <Stack gap="lg">
                <Box>
                  <Title order={2} size={28} fw={600} c="#fff" mb={8}>
                    All Chronicles
                  </Title>
                  <Text size="md" c="gray.6">
                    Every transaction that has been analyzed with AI
                  </Text>
                </Box>

                <Divider color="#222" />

                {isLoadingChronicles ? (
                  <Center py={60}>
                    <Loader size="lg" color="gray" />
                  </Center>
                ) : chronicles.length > 0 ? (
                  <Stack gap="md">
                    {chronicles.map((chronicle) => (
                      <Paper
                        key={chronicle.txHash}
                        p="lg"
                        radius="md"
                        style={{
                          backgroundColor: '#0a0a0a',
                          border: '1px solid #222'
                        }}
                      >
                        <Stack gap="sm">
                          <Group justify="space-between" align="flex-start">
                            <Box style={{ flex: 1 }}>
                              <Text size="xs" c="gray.6" ff="monospace" mb="xs">
                                {chronicle.txHash}
                              </Text>
                              <Text size="md" c="gray.3" style={{ lineHeight: 1.6 }}>
                                {chronicle.narrative}
                              </Text>
                            </Box>
                          </Group>
                          <Divider color="#1a1a1a" />
                          <Group justify="space-between">
                            <Text size="xs" c="gray.6">
                              Analyzed by: {formatAddress(chronicle.requester)}
                            </Text>
                            <Text size="xs" c="gray.6">
                              {formatDate(chronicle.timestamp)}
                            </Text>
                          </Group>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                ) : (
                  <Box py={40} style={{ textAlign: 'center' }}>
                    <Text size="md" c="gray.6">
                      No chronicles yet. Be the first to analyze a transaction!
                    </Text>
                  </Box>
                )}
              </Stack>
            </Paper>
          )}

          {/* Footer */}
          <Box py={30} style={{ borderTop: '1px solid #222' }}>
            <Group justify="space-between" align="center">
              <Text size="sm" c="gray.6">
                Built by <Text component="span" c="#fff" fw={600}>Kotra</Text>
              </Text>
              <Group gap="lg">
                <Anchor
                  href="https://github.com/yourusername/onchain-chronicler"
                  target="_blank"
                  size="sm"
                  c="gray.5"
                  style={{ textDecoration: 'none' }}
                >
                  GitHub
                </Anchor>
                <Anchor
                  href={`https://shannon-explorer.somnia.network/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  size="sm"
                  c="gray.5"
                  style={{ textDecoration: 'none' }}
                >
                  Contract
                </Anchor>
              </Group>
            </Group>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}

export default App;