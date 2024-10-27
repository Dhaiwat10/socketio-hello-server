import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Types
type Player = {
    id: string;
    name: string;
    symbol: 'X' | 'O';
}

type GameState = {
    id: string;
    board: (string | null)[];
    players: Player[];
    currentTurn: string | null;  // socket.id of current player
    status: 'waiting' | 'playing' | 'finished';
    winner: string | null;  // socket.id of winner
}

// Store active games
const games = new Map<string, GameState>();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Create a new game
    socket.on('createGame', (playerName: string) => {
        const gameId = Math.random().toString(36).substring(7);
        const game: GameState = {
            id: gameId,
            board: Array(9).fill(null),
            players: [{
                id: socket.id,
                name: playerName,
                symbol: 'X'
            }],
            currentTurn: null,
            status: 'waiting',
            winner: null
        };
        
        games.set(gameId, game);
        socket.join(gameId);
        socket.emit('gameCreated', game);
        console.log(`Game created: ${gameId} by ${playerName}`);
    });

    // Join an existing game
    socket.on('joinGame', ({ gameId, playerName }: { gameId: string, playerName: string }) => {
        const game = games.get(gameId);
        
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        if (game.players.length === 2) {
            socket.emit('error', 'Game is full');
            return;
        }

        // Add second player
        game.players.push({
            id: socket.id,
            name: playerName,
            symbol: 'O'
        });

        // Start the game
        game.status = 'playing';
        game.currentTurn = game.players[0].id;  // X goes first

        socket.join(gameId);
        io.to(gameId).emit('gameUpdate', game);
        console.log(`${playerName} joined game: ${gameId}`);
    });

    // Handle moves
    socket.on('makeMove', ({ gameId, position }: { gameId: string, position: number }) => {
        const game = games.get(gameId);
        
        if (!game) {
            socket.emit('error', 'Game not found');
            return;
        }

        if (game.status !== 'playing') {
            socket.emit('error', 'Game is not in progress');
            return;
        }

        if (game.currentTurn !== socket.id) {
            socket.emit('error', 'Not your turn');
            return;
        }

        if (position < 0 || position > 8 || game.board[position] !== null) {
            socket.emit('error', 'Invalid move');
            return;
        }

        // Make the move
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;
        
        game.board[position] = player.symbol;

        // Check for winner
        if (checkWinner(game.board)) {
            game.status = 'finished';
            game.winner = socket.id;
        } 
        // Check for draw
        else if (!game.board.includes(null)) {
            game.status = 'finished';
            game.winner = null;
        } 
        // Switch turns
        else {
            game.currentTurn = game.players.find(p => p.id !== socket.id)?.id || null;
        }

        io.to(gameId).emit('gameUpdate', game);
    });

    // Handle disconnections
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Find any games this player was in
        games.forEach((game, gameId) => {
            if (game.players.some(p => p.id === socket.id)) {
                // If game hasn't started, remove it
                if (game.status === 'waiting') {
                    games.delete(gameId);
                }
                // If game is in progress, mark it as finished
                else if (game.status === 'playing') {
                    game.status = 'finished';
                    game.winner = game.players.find(p => p.id !== socket.id)?.id || null;
                    io.to(gameId).emit('gameUpdate', game);
                }
            }
        });
    });
});

// Helper function to check for a winner
function checkWinner(board: (string | null)[]): boolean {
    const winningCombos = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
        [0, 4, 8], [2, 4, 6]             // Diagonals
    ];

    return winningCombos.some(([a, b, c]) => 
        board[a] && 
        board[a] === board[b] && 
        board[a] === board[c]
    );
}

const PORT = 3001;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});