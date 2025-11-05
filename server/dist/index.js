"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ethers_1 = require("ethers");
const ChronicleRegistry_json_1 = __importDefault(require("./abi/ChronicleRegistry.json"));
// --- CONFIGURATION ---
const PORT = process.env.PORT || 3003;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const SOMNIA_RPC_URL = process.env.SOMNIA_RPC_URL;
const AI_AGENT_PRIVATE_KEY = process.env.AI_AGENT_PRIVATE_KEY;
const GAIA_NODE_URL = process.env.GAIA_NODE_URL;
const GAIA_API_KEY = process.env.GAIA_API_KEY;
const GAIA_MODEL_NAME = process.env.GAIA_MODEL_NAME || 'Llama-3.2-3B-Instruct';
// --- EXPRESS APP SETUP ---
const app = (0, express_1.default)();
// =================================================================
//                 *** THE STANDARD CORS FIX ***
// This is the simplest and most reliable way. It MUST be placed
// before your routes and before the express.json() parser.
// =================================================================
app.use((0, cors_1.default)());
// The JSON parser for reading request bodies.
app.use(express_1.default.json());
// --- BLOCKCHAIN SETUP ---
const provider = new ethers_1.ethers.JsonRpcProvider(SOMNIA_RPC_URL);
const aiWallet = new ethers_1.ethers.Wallet(AI_AGENT_PRIVATE_KEY, provider);
const contract = new ethers_1.Contract(CONTRACT_ADDRESS, ChronicleRegistry_json_1.default, aiWallet);
// --- AI ANALYSIS FUNCTION ---
async function analyzeTransactionWithAI(txData) {
    const valueInEth = ethers_1.ethers.formatEther(txData.value || 0);
    const fromAddr = txData.from ? `${txData.from.slice(0, 6)}...${txData.from.slice(-4)}` : 'Unknown';
    const toAddr = txData.to ? `${txData.to.slice(0, 6)}...${txData.to.slice(-4)}` : 'Contract Creation';
    const prompt = `You are a blockchain data analyst writing educational summaries. Your task is to describe blockchain transaction data in plain English for transparency and educational purposes.

Given this public blockchain record:
- Transaction ID: ${txData.hash.slice(0, 10)}...
- Sender address: ${fromAddr}
- Receiver address: ${toAddr}
- Amount transferred: ${valueInEth} STT
- Block number: ${txData.blockNumber}
- Gas limit: ${txData.gasLimit?.toString() || 'N/A'}

Write a brief, factual 2-3 sentence description of this transaction data. Focus only on describing what the data shows - do not provide any financial advice or recommendations. Use simple, educational language suitable for a blockchain explorer or audit log.`;
    const response = await fetch(`${GAIA_NODE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GAIA_API_KEY}`
        },
        body: JSON.stringify({
            model: GAIA_MODEL_NAME,
            messages: [
                {
                    role: 'system',
                    content: 'You are a technical documentation assistant that describes blockchain transaction data for educational and transparency purposes. You provide factual, neutral descriptions of public blockchain records without making recommendations or facilitating any activities.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.5,
            max_tokens: 120
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error('[Error] Gaia API failed:', response.statusText);
        throw new Error(`Gaia API error: ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error('[Error] Invalid AI response format');
        throw new Error('Invalid response from Gaia API');
    }
    return data.choices[0].message.content.trim();
}
// --- ROUTES ---
// 1. Health Check Route
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
// 2. Leaderboard Route - fetches top users by points
app.get('/api/leaderboard', async (req, res) => {
    try {
        const currentBlock = await provider.getBlockNumber();
        const userAddressesSet = new Set();
        // Query events in chunks of 1000 blocks to avoid RPC limits
        const CHUNK_SIZE = 1000;
        const LOOKBACK_BLOCKS = 10000; // Look back 10k blocks
        const startBlock = Math.max(0, currentBlock - LOOKBACK_BLOCKS);
        for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += CHUNK_SIZE) {
            const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
            try {
                const filter = contract.filters.RequestSubmitted();
                const events = await contract.queryFilter(filter, fromBlock, toBlock);
                // Extract unique user addresses
                events.forEach((event) => {
                    if (event.args?.user) {
                        userAddressesSet.add(event.args.user);
                    }
                });
            }
            catch (chunkError) {
                console.error(`[Error] Querying blocks ${fromBlock}-${toBlock}:`, chunkError.message);
                // Continue with next chunk even if one fails
            }
        }
        const userAddresses = Array.from(userAddressesSet);
        // Fetch points for each user
        const leaderboardData = await Promise.all(userAddresses.map(async (address) => {
            try {
                const points = await contract.userPoints(address);
                return {
                    address,
                    points: Number(points)
                };
            }
            catch (error) {
                return { address, points: 0 };
            }
        }));
        // Sort by points descending and take top 10
        const topUsers = leaderboardData
            .filter(user => user.points > 0)
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);
        res.status(200).json({ leaderboard: topUsers });
    }
    catch (error) {
        console.error('[Error] Failed to fetch leaderboard:', error.message);
        res.status(500).json({
            message: 'Failed to fetch leaderboard',
            error: error.message
        });
    }
});
// 2a. Get All Chronicles - fetches all analyzed transactions
app.get('/api/chronicles', async (req, res) => {
    try {
        const currentBlock = await provider.getBlockNumber();
        const CHUNK_SIZE = 1000;
        const LOOKBACK_BLOCKS = 50000; // Look back 50k blocks for more history
        const startBlock = Math.max(0, currentBlock - LOOKBACK_BLOCKS);
        const chroniclesMap = new Map();
        for (let fromBlock = startBlock; fromBlock <= currentBlock; fromBlock += CHUNK_SIZE) {
            const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
            try {
                const filter = contract.filters.ChronicleAdded();
                const events = await contract.queryFilter(filter, fromBlock, toBlock);
                for (const event of events) {
                    const txHash = event.args?.txHash;
                    const narrative = event.args?.narrative;
                    const requester = event.args?.requester;
                    if (txHash && narrative && requester) {
                        const block = await event.getBlock();
                        chroniclesMap.set(txHash, {
                            txHash,
                            narrative,
                            requester,
                            timestamp: block.timestamp
                        });
                    }
                }
            }
            catch (chunkError) {
                console.error(`[Error] Querying chronicles ${fromBlock}-${toBlock}:`, chunkError.message);
            }
        }
        const chronicles = Array.from(chroniclesMap.values())
            .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
        res.status(200).json({
            total: chronicles.length,
            chronicles
        });
    }
    catch (error) {
        console.error('[Error] Failed to fetch chronicles:', error.message);
        res.status(500).json({
            message: 'Failed to fetch chronicles',
            error: error.message
        });
    }
});
// 2b. Check Chronicle Status - checks if chronicle exists or request is pending
app.post('/api/check-chronicle-status', async (req, res) => {
    const { txHash } = req.body;
    if (!txHash || !ethers_1.ethers.isHexString(txHash, 32)) {
        return res.status(400).json({ message: 'Invalid transaction hash.' });
    }
    try {
        // Check if chronicle already exists
        const chronicle = await contract.chronicles(txHash);
        const chronicleExists = chronicle && chronicle.length > 0;
        // Check if request is pending
        const pendingRequester = await contract.pendingRequests(txHash);
        const requestPending = pendingRequester && pendingRequester !== ethers_1.ethers.ZeroAddress;
        // Get actual submission fee from contract
        const actualSubmissionFee = await contract.submissionFee();
        res.status(200).json({
            chronicleExists,
            requestPending,
            chronicle: chronicleExists ? chronicle : null,
            requester: requestPending ? pendingRequester : null,
            submissionFee: actualSubmissionFee.toString()
        });
    }
    catch (error) {
        console.error('[Error] Check status failed:', error.message);
        res.status(500).json({
            message: 'Failed to check chronicle status',
            error: error.message
        });
    }
});
// Helper function to wait for pending request to exist on-chain
async function waitForPendingRequest(txHash, maxAttempts = 60, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const pendingRequester = await contract.pendingRequests(txHash);
            if (pendingRequester && pendingRequester !== ethers_1.ethers.ZeroAddress) {
                console.log(`✓ Pending request confirmed after ${attempt * delayMs / 1000}s`);
                return true;
            }
            // Only log every 10 attempts to reduce noise
            if (attempt % 10 === 0) {
                console.log(`⏳ Waiting for confirmation... (${attempt}/${maxAttempts})`);
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        catch (error) {
            console.error(`[Error] Checking pending request:`, error.message);
        }
    }
    return false;
}
// 3. Main API Endpoint - Analyze Transaction
app.post('/api/analyze-transaction', async (req, res) => {
    const { txHash } = req.body;
    if (!txHash || !ethers_1.ethers.isHexString(txHash, 32)) {
        return res.status(400).json({ message: 'Invalid transaction hash.' });
    }
    try {
        // Check if pending request exists, wait for it if not
        const hasPendingRequest = await waitForPendingRequest(txHash, 60, 2000); // Wait up to 2 minutes
        if (!hasPendingRequest) {
            console.error('[Error] No pending request found for', txHash.slice(0, 10) + '...');
            return res.status(400).json({
                message: 'No pending request found. Please submit a chronicle request from the UI first.',
                error: 'PENDING_REQUEST_NOT_FOUND'
            });
        }
        // Fetch transaction details from blockchain
        const tx = await provider.getTransaction(txHash);
        if (!tx) {
            return res.status(404).json({ message: 'Transaction not found on Somnia network.' });
        }
        // Analyze transaction with AI
        console.log('🤖 Analyzing with AI...');
        const narrative = await analyzeTransactionWithAI(tx);
        // Store chronicle on-chain
        console.log('📝 Storing chronicle on-chain...');
        const txResponse = await contract.addChronicle(txHash, narrative);
        await txResponse.wait();
        console.log('✓ Chronicle stored successfully!');
        res.status(200).json({
            message: 'Analysis complete!',
            narrative,
            chronicleTxHash: txResponse.hash
        });
    }
    catch (error) {
        console.error('[Error] Analysis failed:', error.message);
        res.status(500).json({
            message: 'An internal server error occurred.',
            error: error.message
        });
    }
});
// --- START SERVER ---
app.listen(PORT, () => {
    console.log('\n🚀 Chronicle AI Server');
    console.log(`   Port: ${PORT}`);
    console.log(`   Agent: ${aiWallet.address}`);
    console.log(`   Status: Ready\n`);
});
