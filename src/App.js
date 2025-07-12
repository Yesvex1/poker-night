import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, serverTimestamp, runTransaction, query, getDocs, deleteDoc } from 'firebase/firestore';

// --- Firebase Configuration ---
// IMPORTANT: You MUST replace the placeholder values below with your own
// Firebase project's configuration for the app to work.
//
// How to get your Firebase config:
// 1. Go to the Firebase Console: https://console.firebase.google.com/
// 2. Select your project.
// 3. In the project overview, click the Web icon (</>) to go to your web app's settings.
// 4. If you haven't created a web app yet, do so now.
// 5. In your app's settings, find the "SDK setup and configuration" section.
// 6. Select "Config" and copy the entire firebaseConfig object.
// 7. Paste it here, replacing the placeholder object below.
const firebaseConfig = {
  apiKey: "AIzaSyAtptYDaij6TsorYbRcLS3Jl8gIbqmVR0w",
  authDomain: "poker-night-1.firebaseapp.com",
  projectId: "poker-night-1",
  storageBucket: "poker-night-1.firebasestorage.app",
  messagingSenderId: "775822580912",
  appId: "1:775822580912:web:fd5ee4d87ae136ed182f75",
  measurementId: "G-6LZR4QDKCY"
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Game Configuration ---
const MAX_PLAYERS = 9;
const MAX_BUY_IN = 800;
const BIG_BLIND = 2;
const SMALL_BLIND = 1;

// --- Card Data ---
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

// --- Helper Functions ---
const createDeck = () => {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ suit, rank });
        }
    }
    return deck;
};

const shuffleDeck = (deck) => {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
};

// --- Hand Evaluation Logic ---
const evaluateHand = (holeCards, communityCards) => {
    const allCards = [...holeCards, ...communityCards];
    if (allCards.length < 5) return { rank: 0, name: "No Hand", hand: [] };

    const flush = findFlush(allCards);
    const straight = findStraight(allCards);

    if (flush && straight) {
        const straightFlushCards = flush.hand.filter(c => straight.hand.some(sc => sc.rank === c.rank && sc.suit === c.suit));
        if (straightFlushCards.length >= 5) {
            const straightFlush = findStraight(straightFlushCards);
            if (straightFlush) {
                if (straightFlush.hand.some(c => c.rank === 'A') && straightFlush.hand.some(c => c.rank === 'K')) return { rank: 9, name: "Royal Flush", hand: straightFlush.hand };
                return { rank: 8, name: "Straight Flush", hand: straightFlush.hand };
            }
        }
    }
    
    const groups = groupCardsByRank(allCards);
    const fourOfAKind = findNOfAKind(groups, 4, allCards);
    if (fourOfAKind) return fourOfAKind;

    const fullHouse = findFullHouse(groups);
    if (fullHouse) return fullHouse;
    
    if (flush) return flush;
    if (straight) return straight;

    const threeOfAKind = findNOfAKind(groups, 3, allCards);
    if (threeOfAKind) return threeOfAKind;
    
    const twoPair = findTwoPair(groups, allCards);
    if (twoPair) return twoPair;

    const onePair = findNOfAKind(groups, 2, allCards);
    if (onePair) return onePair;
    
    return findHighCard(allCards);
};

const groupCardsByRank = (cards) => {
    return cards.reduce((acc, card) => {
        acc[card.rank] = (acc[card.rank] || []).concat(card);
        return acc;
    }, {});
};

const findNOfAKind = (groups, n, allCards) => {
    const ranks = Object.keys(groups).filter(rank => groups[rank].length === n).sort((a,b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (ranks.length === 0) return null;
    const kind = groups[ranks[0]];
    const kickers = allCards.filter(c => !kind.includes(c)).sort((a,b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]).slice(0, 5 - n);
    const hand = [...kind, ...kickers];

    let name = "";
    if (n === 4) name = "Four of a Kind";
    if (n === 3) name = "Three of a Kind";
    if (n === 2) name = "One Pair";
    
    return { rank: n === 4 ? 7 : (n === 3 ? 3 : 1), name, hand };
};

const findTwoPair = (groups, allCards) => {
    const pairs = Object.keys(groups).filter(rank => groups[rank].length === 2).sort((a,b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (pairs.length < 2) return null;
    const highPair = groups[pairs[0]];
    const lowPair = groups[pairs[1]];
    const kicker = allCards.filter(c => c.rank !== pairs[0] && c.rank !== pairs[1]).sort((a,b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]).slice(0, 1);
    return { rank: 2, name: "Two Pair", hand: [...highPair, ...lowPair, ...kicker] };
};

const findFullHouse = (groups) => {
    const threes = Object.keys(groups).filter(rank => groups[rank].length === 3).sort((a,b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (threes.length === 0) return null;
    const twos = Object.keys(groups).filter(rank => groups[rank].length >= 2 && rank !== threes[0]).sort((a,b) => RANK_VALUES[b] - RANK_VALUES[a]);
    if (twos.length === 0) return null;
    const three = groups[threes[0]];
    const two = groups[twos[0]].slice(0,2);
    return { rank: 6, name: "Full House", hand: [...three, ...two] };
};

const findFlush = (cards) => {
    for (const suit of SUITS) {
        const suitCards = cards.filter(c => c.suit === suit);
        if (suitCards.length >= 5) {
            const hand = suitCards.sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]).slice(0, 5);
            return { rank: 5, name: "Flush", hand };
        }
    }
    return null;
};

const findStraight = (cards) => {
    const uniqueCards = [...new Map(cards.map(c => [c.rank, c])).values()];
    const sortedCards = uniqueCards.sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank]);
    
    const hasAce = sortedCards.some(c => c.rank === 'A');
    if (hasAce) {
        const lowStraightRanks = ['2', '3', '4', '5'];
        const isAceLow = lowStraightRanks.every(rank => sortedCards.some(c => c.rank === rank));
        if (isAceLow) {
            return { rank: 4, name: "Straight", hand: [
                sortedCards.find(c => c.rank === '5'),
                sortedCards.find(c => c.rank === '4'),
                sortedCards.find(c => c.rank === '3'),
                sortedCards.find(c => c.rank === '2'),
                sortedCards.find(c => c.rank === 'A'),
            ].reverse()};
        }
    }

    for (let i = sortedCards.length - 1; i >= 4; i--) {
        let isStraight = true;
        for (let j = 0; j < 4; j++) {
            if (RANK_VALUES[sortedCards[i - j].rank] !== RANK_VALUES[sortedCards[i - j - 1].rank] + 1) {
                isStraight = false;
                break;
            }
        }
        if (isStraight) {
            return { rank: 4, name: "Straight", hand: sortedCards.slice(i - 4, i + 1).reverse() };
        }
    }
    return null;
};

const findHighCard = (cards) => {
    const hand = cards.sort((a, b) => RANK_VALUES[b.rank] - RANK_VALUES[a.rank]).slice(0, 5);
    return { rank: 0, name: `High Card: ${hand[0].rank}`, hand };
};

const compareHands = (handA, handB) => {
    if (handA.rank !== handB.rank) return handB.rank - handA.rank;
    for (let i = 0; i < 5; i++) {
        if (RANK_VALUES[handA.hand[i].rank] !== RANK_VALUES[handB.hand[i].rank]) {
            return RANK_VALUES[handB.hand[i].rank] - RANK_VALUES[handA.hand[i].rank];
        }
    }
    return 0; // Split pot
};

// --- React Components ---

const Card = ({ card, hidden }) => {
    if (!card) return null;
    const cardColor = card.suit === '♥' || card.suit === '♦' ? 'text-red-500' : 'text-black';
    return (
        <div className={`w-16 h-24 md:w-20 md:h-28 bg-white rounded-lg shadow-md flex items-center justify-center m-1 border-2 ${hidden ? 'bg-blue-800 border-blue-900' : 'border-gray-300'}`}>
            {hidden ? (
                <div className="w-full h-full bg-blue-500 rounded-md border-4 border-blue-300"></div>
            ) : (
                <div className="text-center">
                    <span className={`text-3xl font-bold ${cardColor}`}>{card.rank}</span>
                    <span className={`text-2xl ${cardColor}`}>{card.suit}</span>
                </div>
            )}
        </div>
    );
};

const PlayerSeat = ({ player, isMySeat, dealerPosition, smallBlindPosition, bigBlindPosition, currentTurnPlayerId }) => {
    const isDealer = player.seatIndex === dealerPosition;
    const isSmallBlind = player.seatIndex === smallBlindPosition;
    const isBigBlind = player.seatIndex === bigBlindPosition;
    const isTurn = player.id === currentTurnPlayerId;

    return (
        <div className={`absolute transform -translate-x-1/2 p-2 rounded-lg transition-all duration-300 ${isTurn ? 'bg-yellow-300 scale-110 shadow-lg' : 'bg-gray-700'}`} style={player.positionStyle}>
            <div className="text-center text-white">
                <p className="font-bold truncate w-24">{player.name}</p>
                <p className="text-yellow-400">${player.chips}</p>
                 {player.lastAction && <p className="text-xs italic text-gray-300">{player.lastAction}</p>}
                <div className="flex justify-center items-center h-24">
                    {player.hasFolded ? <div className="text-gray-400 text-sm">Folded</div> : player.cards?.map((card, index) => (
                        <Card key={index} card={card} hidden={!player.showCards && !isMySeat} />
                    ))}
                </div>
                {player.currentBet > 0 && (
                    <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-900 px-2 py-1 rounded-full text-xs">
                        ${player.currentBet}
                    </div>
                )}
                {isDealer && <div className="absolute -top-2 -right-2 bg-white text-black w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">D</div>}
                {isSmallBlind && <div className="absolute -top-2 -left-2 bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">SB</div>}
                {isBigBlind && <div className="absolute -top-2 -left-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs">BB</div>}
            </div>
        </div>
    );
};


const PokerTable = ({ gameId, playerId, setPage }) => {
    const [gameState, setGameState] = useState(null);
    const [players, setPlayers] = useState([]);
    const [showRebuyModal, setShowRebuyModal] = useState(false);
    const [rebuyAmount, setRebuyAmount] = useState(100);
    const [raiseAmount, setRaiseAmount] = useState(0);
    const [message, setMessage] = useState("");

    const player = useMemo(() => players.find(p => p.id === playerId), [players, playerId]);
    const activePlayers = useMemo(() => players.filter(p => !p.isSpectator), [players]);
    
    // Firestore paths
    const gameDocRef = useMemo(() => doc(db, `artifacts/${gameId}/public/data/pokerGames`, "gameState"), [gameId]);
    const playersColRef = useMemo(() => collection(gameDocRef, "players"), [gameDocRef]);
    const actionsColRef = useMemo(() => collection(gameDocRef, "actions"), [gameDocRef]);


    useEffect(() => {
        if (!gameId) return;
        
        const unsubscribeGame = onSnapshot(gameDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setGameState(data);
                if(data.lastMessage) {
                    setMessage(data.lastMessage);
                    setTimeout(() => setMessage(""), 5000);
                }
                const minRaise = (data.lastRaise || 0) + (data.currentBet || 0);
                setRaiseAmount(Math.max(BIG_BLIND * 2, minRaise));

            } else {
                setPage('login');
            }
        });

        const unsubscribePlayers = onSnapshot(playersColRef, (snapshot) => {
            const playersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            const numPlayers = playersData.length;
            const radius = 180;
            const positionedPlayers = playersData.map((p, i) => {
                const angle = (i / numPlayers) * 2 * Math.PI;
                p.positionStyle = {
                    top: `${50 - (radius / 3.5) * Math.cos(angle)}%`,
                    left: `${50 + radius * Math.sin(angle)}px`,
                };
                return p;
            });

            setPlayers(positionedPlayers);
        });

        return () => {
            unsubscribeGame();
            unsubscribePlayers();
        };
    }, [gameId, setPage, gameDocRef, playersColRef]);
    
    const handleGameAction = useCallback(async (action, amount = 0) => {
        if (!gameId || !playerId) return;
        const gameActionRef = doc(actionsColRef);
        try {
            await setDoc(gameActionRef, {
                action,
                amount,
                playerId,
                timestamp: serverTimestamp()
            });
        } catch (error) {
            console.error("Error performing game action:", error);
            setMessage("Error: Could not perform action.");
        }
    }, [gameId, playerId, actionsColRef]);
    
    const handleStartGame = async () => {
        if (activePlayers.length < 2) {
            setMessage("Need at least 2 players to start.");
            return;
        }
        const startGameActionRef = doc(actionsColRef);
        await setDoc(startGameActionRef, { action: "startGame", playerId, timestamp: serverTimestamp() });
    };

    const handleRebuy = async () => {
        if (rebuyAmount <= 0 || !gameId || !playerId) return;
        const playerDocRef = doc(playersColRef, playerId);
        try {
            await runTransaction(db, async (transaction) => {
                const playerDoc = await transaction.get(playerDocRef);
                if (!playerDoc.exists()) throw "Player not found!";
                const newChips = playerDoc.data().chips + rebuyAmount;
                transaction.update(playerDocRef, { chips: newChips });
            });
            setShowRebuyModal(false);
            setRebuyAmount(100);
        } catch (error) {
            console.error("Rebuy failed:", error);
            setMessage("Rebuy failed.");
        }
    };

    const toggleSpectate = async () => {
        if (!gameId || !playerId) return;
        const playerDocRef = doc(playersColRef, playerId);
        await setDoc(playerDocRef, { isSpectator: !player?.isSpectator }, { merge: true });
    };

    if (!gameState || !player) {
        return <div className="bg-gray-800 text-white min-h-screen flex items-center justify-center">Loading Table...</div>;
    }

    const isMyTurn = gameState.currentTurnPlayerId === playerId;
    const canCheck = isMyTurn && player.currentBet === gameState.currentBet;
    const callAmount = gameState.currentBet - player.currentBet;

    return (
        <div className="bg-green-800 min-h-screen flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-center bg-black bg-opacity-20 z-20">
                <h1 className="text-white text-2xl font-bold">Poker Night (Game ID: {gameId})</h1>
                <div>
                     <button onClick={toggleSpectate} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded mr-2">
                        {player.isSpectator ? 'Join Game' : 'Spectate'}
                    </button>
                    <button onClick={() => setShowRebuyModal(true)} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
                        Rebuy
                    </button>
                </div>
            </div>

            <div className="relative w-[700px] h-[400px] bg-green-700 rounded-full border-8 border-yellow-800 shadow-2xl flex items-center justify-center">
                <div className="text-center">
                    <div className="flex justify-center mb-2">
                        {gameState.communityCards.map((card, index) => <Card key={index} card={card} />)}
                    </div>
                    <p className="text-white text-xl font-bold bg-black bg-opacity-40 px-4 py-1 rounded-full">Pot: ${gameState.pot}</p>
                </div>

                {players.map(p => (
                    <PlayerSeat 
                        key={p.id} 
                        player={p} 
                        isMySeat={p.id === playerId}
                        dealerPosition={gameState.dealerPosition}
                        smallBlindPosition={gameState.smallBlindPosition}
                        bigBlindPosition={gameState.bigBlindPosition}
                        currentTurnPlayerId={gameState.currentTurnPlayerId}
                    />
                ))}
            </div>

             {message && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-70 text-white text-2xl font-bold p-6 rounded-lg shadow-xl z-30">
                    {message}
                </div>
            )}

            <div className="absolute bottom-0 left-0 w-full p-4 bg-black bg-opacity-20 flex justify-center items-center space-x-2 z-20">
                {gameState.status === 'waiting' && (
                    <button onClick={handleStartGame} className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg text-xl">
                        Start Game ({activePlayers.length} players)
                    </button>
                )}
                {gameState.status === 'in-progress' && isMyTurn && !player.isSpectator && (
                     <>
                        <button onClick={() => handleGameAction('fold')} className="bg-red-600 hover:bg-red-800 text-white font-bold py-2 px-5 rounded">Fold</button>
                        {canCheck ? (
                            <button onClick={() => handleGameAction('check')} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-5 rounded">Check</button>
                        ) : (
                            <button onClick={() => handleGameAction('call')} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-5 rounded">Call ${callAmount}</button>
                        )}
                        <div className="flex items-center space-x-2">
                            <button onClick={() => handleGameAction('raise', raiseAmount)} className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-2 px-5 rounded">Raise</button>
                            <input 
                                type="number" 
                                value={raiseAmount}
                                onChange={(e) => setRaiseAmount(Math.max(0, parseInt(e.target.value, 10)))}
                                min={gameState.currentBet + (gameState.lastRaise || BIG_BLIND)}
                                step={BIG_BLIND}
                                className="w-24 p-2 rounded bg-gray-700 text-white border border-gray-600"
                            />
                        </div>
                         <button onClick={() => handleGameAction('all-in')} className="bg-purple-600 hover:bg-purple-800 text-white font-bold py-2 px-5 rounded">All-in</button>
                    </>
                )}
            </div>

            {showRebuyModal && (
                <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-gray-800 p-8 rounded-lg shadow-xl text-white">
                        <h2 className="text-2xl mb-4">Rebuy Chips</h2>
                        <p className="mb-4">Your current chips: ${player.chips}</p>
                        <input 
                            type="number"
                            value={rebuyAmount}
                            onChange={(e) => setRebuyAmount(parseInt(e.target.value, 10))}
                            className="w-full p-2 rounded bg-gray-700 text-white border border-gray-600 mb-4"
                            max={MAX_BUY_IN}
                            step={10}
                        />
                        <div className="flex justify-between">
                            <button onClick={handleRebuy} className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Confirm</button>
                            <button onClick={() => setShowRebuyModal(false)} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};


const LoginPage = ({ setPage, userId, gameId }) => {
    const [playerName, setPlayerName] = useState('');
    const [buyIn, setBuyIn] = useState(100);
    const [isJoining, setIsJoining] = useState(false);
    const [error, setError] = useState('');

    const handleJoin = async () => {
        if (!playerName.trim()) {
            setError('Player name is required.');
            return;
        }
        if (buyIn <= 0 || buyIn > MAX_BUY_IN) {
            setError(`Buy-in must be between 1 and ${MAX_BUY_IN}.`);
            return;
        }
        if (!userId || !gameId) {
            setError('Authentication not ready. Please wait a moment and try again.');
            return;
        }
        setError('');
        setIsJoining(true);

        try {
            const gameDocRef = doc(db, `artifacts/${gameId}/public/data/pokerGames`, "gameState");
            const playersColRef = collection(gameDocRef, "players");
            const playerDocRef = doc(playersColRef, userId);

            await runTransaction(db, async (transaction) => {
                const gameDoc = await transaction.get(gameDocRef);
                const playersSnapshot = await getDocs(query(playersColRef));
                
                if (!gameDoc.exists()) {
                     transaction.set(gameDocRef, {
                        status: 'waiting',
                        pot: 0,
                        communityCards: [],
                        currentTurnPlayerId: null,
                        currentBet: 0,
                        lastRaise: 0,
                        dealerPosition: -1,
                        smallBlindPosition: -1,
                        bigBlindPosition: -1,
                        lastMessage: `${playerName} created the table!`,
                        createdAt: serverTimestamp(),
                        deck: [],
                        gamePhase: 'waiting'
                    });
                }

                const newPlayer = {
                    name: playerName,
                    chips: buyIn,
                    cards: [],
                    currentBet: 0,
                    hasFolded: false,
                    isSpectator: playersSnapshot.docs.length >= MAX_PLAYERS,
                    seatIndex: playersSnapshot.docs.length,
                    lastAction: playersSnapshot.docs.length >= MAX_PLAYERS ? 'Joined as Spectator' : 'Joined',
                    showCards: false,
                };
                transaction.set(playerDocRef, newPlayer);
            });

            setPage('table');

        } catch (err) {
            console.error("Failed to join game:", err);
            setError('Failed to join the game. Please try again.');
        } finally {
            setIsJoining(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-gray-800 p-8 rounded-xl shadow-2xl">
                <h1 className="text-4xl font-bold text-center mb-2 text-yellow-400">Poker Night</h1>
                <p className="text-center text-gray-400 mb-8">Join the table (Game ID: {gameId || '...'})</p>
                
                {error && <p className="bg-red-500 text-white p-3 rounded-md mb-4">{error}</p>}

                <div className="mb-4">
                    <label htmlFor="playerName" className="block text-sm font-bold mb-2 text-gray-300">Player Name</label>
                    <input
                        id="playerName"
                        type="text"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        placeholder="Enter your name"
                    />
                     <div className="flex justify-start space-x-2 mt-2">
                        {['Thee', 'Trin', 'Big M'].map(name => (
                             <button key={name} onClick={() => setPlayerName(name)} className="bg-gray-600 hover:bg-gray-500 text-xs py-1 px-3 rounded-full">{name}</button>
                        ))}
                    </div>
                </div>

                <div className="mb-6">
                    <label htmlFor="buyIn" className="block text-sm font-bold mb-2 text-gray-300">Buy-in Amount (Max: ${MAX_BUY_IN})</label>
                    <input
                        id="buyIn"
                        type="number"
                        value={buyIn}
                        onChange={(e) => setBuyIn(parseInt(e.target.value, 10))}
                        className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                        max={MAX_BUY_IN}
                    />
                    <div className="flex justify-start space-x-2 mt-2">
                        {[50, 100, 200].map(amount => (
                             <button key={amount} onClick={() => setBuyIn(amount)} className="bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold py-1 px-3 rounded-full">${amount}</button>
                        ))}
                    </div>
                </div>

                <button
                    onClick={handleJoin}
                    disabled={isJoining || !userId}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-md text-lg transition duration-300 disabled:bg-gray-500"
                >
                    {isJoining ? 'Joining...' : 'Join Table'}
                </button>
            </div>
        </div>
    );
};


export default function App() {
    const [page, setPage] = useState('login');
    const [authInfo, setAuthInfo] = useState({ isAuthReady: false, userId: null });
    const [gameId, setGameId] = useState(null);

    // This is the main "game loop" that processes actions.
    // In a production app, this logic would live on a server (e.g., Cloud Functions)
    // to be more secure and authoritative. For this project, one client acts as the "host".
    const gameLogicRunner = useCallback(async (actionDoc) => {
        const actionData = actionDoc.data();
        const actionId = actionDoc.id;

        await runTransaction(db, async (transaction) => {
            const gameDocRef = doc(db, `artifacts/${gameId}/public/data/pokerGames`, "gameState");
            const playersColRef = collection(gameDocRef, "players");

            const gameDoc = await transaction.get(gameDocRef);
            if (!gameDoc.exists()) return;
            
            const playersSnapshot = await getDocs(query(playersColRef));
            let playersData = playersSnapshot.docs.map(d => ({id: d.id, ...d.data()}));
            let gameStateData = gameDoc.data();
            
            if (actionData.action === 'startGame') {
                 gameStateData = handleStartGameLogic(gameStateData, playersData);
            } else {
                const result = handlePlayerActionLogic(gameStateData, playersData, actionData);
                gameStateData = result.gameState;
                playersData = result.players;
            }
            
            for(const p of playersData) {
                const playerDocRef = doc(playersColRef, p.id);
                transaction.set(playerDocRef, p);
            }
            
            transaction.set(gameDocRef, gameStateData);
        });

        // Clean up the processed action
        await deleteDoc(doc(collection(doc(db, `artifacts/${gameId}/public/data/pokerGames`, "gameState"), "actions"), actionId));
    }, [gameId]);


    useEffect(() => {
        // All players must use the same gameId to join the same table.
        // You can change this to any unique string.
        const appId = 'poker-night-live';
        setGameId(appId);

        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setAuthInfo({ isAuthReady: true, userId: user.uid });
            } else {
                 try {
                    await signInAnonymously(auth);
                } catch (error) {
                    console.error("Anonymous authentication failed:", error);
                    setAuthInfo({ isAuthReady: true, userId: null });
                }
            }
        });

        return () => unsubscribeAuth();
    }, []);

    useEffect(() => {
        if (!authInfo.isAuthReady || !gameId) return;

        const actionsColRef = collection(db, `artifacts/${gameId}/public/data/pokerGames/gameState/actions`);
        const unsubscribeActions = onSnapshot(actionsColRef, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    gameLogicRunner(change.doc);
                }
            });
        });

        return () => unsubscribeActions();
    }, [authInfo.isAuthReady, gameId, gameLogicRunner]);

    const handleStartGameLogic = (gameState, players) => {
        const activePlayers = players.filter(p => !p.isSpectator && p.chips > 0);
        if (activePlayers.length < 2) {
            return { ...gameState, lastMessage: "Not enough players to start." };
        }

        let deck = shuffleDeck(createDeck());
        
        activePlayers.forEach(p => {
            p.cards = [deck.pop(), deck.pop()];
            p.hasFolded = false;
            p.currentBet = 0;
            p.lastAction = '';
            p.showCards = false;
        });

        const dealerPos = (gameState.dealerPosition + 1) % activePlayers.length;
        const smallBlindPos = (dealerPos + 1) % activePlayers.length;
        const bigBlindPos = (dealerPos + 2) % activePlayers.length;
        
        const sbPlayer = activePlayers[smallBlindPos];
        const bbPlayer = activePlayers[bigBlindPos];

        const sbAmount = Math.min(sbPlayer.chips, SMALL_BLIND);
        sbPlayer.chips -= sbAmount;
        sbPlayer.currentBet = sbAmount;

        const bbAmount = Math.min(bbPlayer.chips, BIG_BLIND);
        bbPlayer.chips -= bbAmount;
        bbPlayer.currentBet = bbAmount;

        const turnPos = (bigBlindPos + 1) % activePlayers.length;

        return {
            ...gameState,
            status: 'in-progress',
            deck: JSON.parse(JSON.stringify(deck)),
            communityCards: [],
            pot: sbAmount + bbAmount,
            currentBet: BIG_BLIND,
            lastRaise: BIG_BLIND,
            dealerPosition: dealerPos,
            smallBlindPosition: smallBlindPos,
            bigBlindPosition: bigBlindPos,
            currentTurnPlayerId: activePlayers[turnPos].id,
            gamePhase: 'pre-flop',
            lastMessage: "New hand started!"
        };
    };

    const handlePlayerActionLogic = (gameState, players, actionData) => {
        const player = players.find(p => p.id === actionData.playerId);
        if (!player || gameState.currentTurnPlayerId !== player.id) return { gameState, players };

        let activePlayers = players.filter(p => !p.isSpectator && !p.hasFolded);
        const currentIndex = activePlayers.findIndex(p => p.id === player.id);

        switch(actionData.action) {
            case 'fold':
                player.hasFolded = true;
                player.lastAction = 'Fold';
                break;
            case 'check':
                player.lastAction = 'Check';
                break;
            case 'call':
                const callAmount = Math.min(player.chips, gameState.currentBet - player.currentBet);
                player.chips -= callAmount;
                player.currentBet += callAmount;
                gameState.pot += callAmount;
                player.lastAction = 'Call';
                break;
            case 'raise':
                const totalBet = actionData.amount;
                const raiseFromPlayer = totalBet - player.currentBet;

                if (raiseFromPlayer > player.chips || totalBet < gameState.currentBet + (gameState.lastRaise || BIG_BLIND)) {
                    player.lastAction = 'Invalid Raise';
                } else {
                    player.chips -= raiseFromPlayer;
                    gameState.pot += raiseFromPlayer;
                    gameState.lastRaise = totalBet - gameState.currentBet;
                    gameState.currentBet = totalBet;
                    player.currentBet = totalBet;
                    player.lastAction = `Raise to ${totalBet}`;
                }
                break;
             case 'all-in':
                const allInAmount = player.chips;
                player.currentBet += allInAmount;
                gameState.pot += allInAmount;
                if(player.currentBet > gameState.currentBet) {
                    gameState.lastRaise = player.currentBet - gameState.currentBet;
                    gameState.currentBet = player.currentBet;
                }
                player.chips = 0;
                player.lastAction = 'All-in';
                break;
            default:
                break;
        }
        
        activePlayers = players.filter(p => !p.isSpectator && !p.hasFolded);
        
        if (activePlayers.length < 2) {
            const winner = activePlayers[0];
            if(winner) {
                winner.chips += gameState.pot;
                gameState.lastMessage = `${winner.name} wins $${gameState.pot}`;
            }
            gameState.status = 'waiting';
            return { gameState, players };
        }

        const nextTurnPlayer = () => {
            let nextIndex = (activePlayers.findIndex(p => p.id === gameState.currentTurnPlayerId) + 1) % activePlayers.length;
            for(let i=0; i< activePlayers.length; i++) {
                const p = activePlayers[nextIndex];
                if(!p.hasFolded && p.chips > 0) return p.id;
                nextIndex = (nextIndex + 1) % activePlayers.length;
            }
            return null;
        }
        
        const betsAreEqual = activePlayers.filter(p=>!p.hasFolded).every(p => p.currentBet === gameState.currentBet || p.chips === 0);
        
        if (betsAreEqual) {
            gameState.currentTurnPlayerId = activePlayers[(gameState.smallBlindPosition + activePlayers.length) % activePlayers.length]?.id;
            gameState.currentBet = 0;
            gameState.lastRaise = 0;
            players.forEach(p => { if(!p.hasFolded) { p.currentBet = 0; p.lastAction = ''; } });

            switch(gameState.gamePhase) {
                case 'pre-flop':
                    gameState.gamePhase = 'flop';
                    gameState.communityCards = [gameState.deck.pop(), gameState.deck.pop(), gameState.deck.pop()];
                    break;
                case 'flop':
                    gameState.gamePhase = 'turn';
                    gameState.communityCards.push(gameState.deck.pop());
                    break;
                case 'turn':
                    gameState.gamePhase = 'river';
                    gameState.communityCards.push(gameState.deck.pop());
                    break;
                case 'river':
                    gameState.gamePhase = 'showdown';
                    const showdownPlayers = activePlayers.filter(p => !p.hasFolded);
                    showdownPlayers.forEach(p => {
                        p.handDetails = evaluateHand(p.cards, gameState.communityCards);
                        p.showCards = true;
                    });
                    
                    showdownPlayers.sort((a,b) => compareHands(a.handDetails, b.handDetails));
                    const winner = showdownPlayers[0];
                    winner.chips += gameState.pot;
                    gameState.lastMessage = `${winner.name} wins $${gameState.pot} with a ${winner.handDetails.name}`;
                    gameState.status = 'waiting';
                    break;
                default:
                    break;
            }
        } else {
             gameState.currentTurnPlayerId = nextTurnPlayer();
        }

        return {gameState, players};
    };

    if (!authInfo.isAuthReady) {
        return <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center">Authenticating...</div>
    }

    return (
        <>
            {page === 'login' && <LoginPage setPage={setPage} userId={authInfo.userId} gameId={gameId} />}
            {page === 'table' && <PokerTable gameId={gameId} playerId={authInfo.userId} setPage={setPage} />}
        </>
    );
}
