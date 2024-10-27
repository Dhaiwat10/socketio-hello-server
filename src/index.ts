import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Types
type Player = {
  id: string; // socket id of the connection
  name: string;
  symbol?: 'X' | 'O';
  inQueue: boolean;
  inGame: boolean;
};

type GameState = {
  id: string;
  board: (string | null)[];
  players: Player[];
  currentTurn: string | null; // socket.id of current player
  status: 'waiting' | 'playing' | 'finished';
  winner: string | null; // socket.id of winner
};

// Store active games
const games = new Map<string, GameState>();
const players = new Map<string, Player>();
const mmQueue: string[] = []; // array of player IDs waiting in the queue

const emitQueueSize = () => {
  io.emit('queueSize', mmQueue.length);
};

const tryToCreateGame = () => {
  if (mmQueue.length < 2) return;

  // Take first two players from queue and remove them
  const [player1Id, player2Id] = mmQueue.splice(0, 2);
  const player1 = players.get(player1Id);
  const player2 = players.get(player2Id);

  if (!player1 || !player2) return;

  const gameId = Math.random().toString(36).substring(7);

  const game: GameState = {
    id: gameId,
    board: Array(9).fill(null),
    players: [player1, player2],
    currentTurn: null,
    status: 'waiting',
    winner: null,
  };

  player1.symbol = 'X';
  player2.symbol = 'O';

  games.set(gameId, game);

  io.to(player1.id).emit('gameFound', game.id);
  io.to(player2.id).emit('gameFound', game.id);

  console.log(`Game found for players ${player1.name} and ${player2.name}`);

  // Update queue size after creating game
  emitQueueSize();
};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('joinQueue', (playerName: string) => {
    const player: Player = {
      id: socket.id,
      name: playerName,
      inGame: false,
      inQueue: true,
    };
    players.set(socket.id, player);
    mmQueue.push(socket.id);
    console.log(`Player ${playerName} joined queue`);

    emitQueueSize();
    tryToCreateGame();
  });

  socket.on('leaveQueue', () => {
    const player = players.get(socket.id);
    if (!player) return;

    player.inQueue = false;
    const queueIndex = mmQueue.indexOf(socket.id);
    if (queueIndex !== -1) {
      mmQueue.splice(queueIndex, 1);
      console.log(`Player ${player.name} left queue`);
      emitQueueSize();
    }
  });

  socket.on('joinGame', ({ gameId }: { gameId: string }) => {
    const game = games.get(gameId);

    if (!game) {
      socket.emit('error', 'Game not found');
      return;
    }

    // check if player is allowed to join
    if (socket.id !== game.players[0].id && socket.id !== game.players[1].id) {
      socket.emit('error', 'You are not allowed to join this game');
      return;
    }

    const player = players.get(socket.id);
    if (!player) return;

    console.log(`Player ${player.name} joined game: ${gameId}`);

    const otherPlayer = game.players.find((p) => p.id !== socket.id);
    if (!otherPlayer) return;

    player.inGame = true;
    player.inQueue = false;

    if (player.inGame && otherPlayer.inGame) {
      game.status = 'playing';
      game.currentTurn = game.players[0].id;
    }

    socket.join(gameId);
    io.to(gameId).emit('gameUpdate', game);

    console.log(`${player.name} joined game: ${gameId}`);
  });

  socket.on(
    'makeMove',
    ({ gameId, position }: { gameId: string; position: number }) => {
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
      const player = game.players.find((p) => p.id === socket.id);
      const otherPlayer = game.players.find((p) => p.id !== socket.id);
      if (!player || !otherPlayer) return;

      if (!player.symbol) {
        return;
      }

      game.board[position] = player.symbol;

      // Check for winner
      if (checkWinner(game.board)) {
        game.status = 'finished';
        game.winner = socket.id;

        player.symbol = undefined;
        player.inGame = false;
        otherPlayer.symbol = undefined;
        otherPlayer.inGame = false;
      }
      // Check for draw
      else if (!game.board.includes(null)) {
        game.status = 'finished';
        game.winner = null;

        player.symbol = undefined;
        player.inGame = false;
        otherPlayer.symbol = undefined;
        otherPlayer.inGame = false;
      }
      // Switch turns
      else {
        game.currentTurn = otherPlayer.id;
      }

      io.to(gameId).emit('gameUpdate', game);
    }
  );

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove from queue if present
    const queueIndex = mmQueue.indexOf(socket.id);
    if (queueIndex !== -1) {
      mmQueue.splice(queueIndex, 1);
      emitQueueSize();
    }

    // Find any games this player was in
    games.forEach((game, gameId) => {
      if (game.players.some((p) => p.id === socket.id)) {
        // If game hasn't started, remove it
        if (game.status === 'waiting') {
          games.delete(gameId);
        }
        // If game is in progress, mark it as finished
        else if (game.status === 'playing') {
          game.status = 'finished';
          game.winner =
            game.players.find((p) => p.id !== socket.id)?.id || null;
          io.to(gameId).emit('gameUpdate', game);
        }
      }
    });

    // Clean up player data
    players.delete(socket.id);
  });
});

function checkWinner(board: (string | null)[]): boolean {
  const winningCombos = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8], // Rows
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8], // Columns
    [0, 4, 8],
    [2, 4, 6], // Diagonals
  ];

  return winningCombos.some(
    ([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]
  );
}

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
