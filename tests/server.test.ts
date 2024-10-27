// tests/server.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Server } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';

describe('Game Server', () => {
    // let io: Server;
    let clientSocket1: ClientSocket;
    let clientSocket2: ClientSocket;
    // let httpServer: HttpServer;
    let port: number;

    // beforeAll(async () => {
    //     // httpServer = createServer();
    //     // io = new Server(httpServer);
        
    //     await new Promise<void>(resolve => {
    //         httpServer.listen(() => {
    //             port = (httpServer.address() as AddressInfo).port;
    //             resolve();
    //         });
    //     });
    // });

    // afterAll(() => {
    //     io.close();
    //     // httpServer.close();
    // });

    beforeEach(async () => {
        clientSocket1 = Client(`http://localhost:3001`);
        clientSocket2 = Client(`http://localhost:3001`);
        
        await Promise.all([
            new Promise<void>(resolve => clientSocket1.on('connect', resolve)),
            new Promise<void>(resolve => clientSocket2.on('connect', resolve))
        ]);
    });

    afterEach(() => {
        clientSocket1.close();
        clientSocket2.close();
    });

    test('matchmaking - should allow a player to join the queue', async () => {
        const queueSizePromise = new Promise<number>(resolve => {
            clientSocket1.on('queueSize', resolve);
        });

        clientSocket1.emit('joinQueue', 'Player1');
        const size = await queueSizePromise;
        
        expect(size).toBe(1);
    });

    test('matchmaking - should match two players', async () => {
        const gameFoundPromise = Promise.all([
            new Promise<void>(resolve => clientSocket1.on('gameFound', resolve)),
            new Promise<void>(resolve => clientSocket2.on('gameFound', resolve))
        ]);

        clientSocket1.emit('joinQueue', 'Player1');
        clientSocket2.emit('joinQueue', 'Player2');

        await gameFoundPromise;
    });

    test('gameplay - should play a complete game', async () => {
        let gameId: string;

        // Set up game ID promise
        const gameFoundPromise = new Promise<string>(resolve => {
            clientSocket1.on('gameFound', resolve);
        });

        // Join queue
        clientSocket1.emit('joinQueue', 'Player1');
        clientSocket2.emit('joinQueue', 'Player2');

        // Wait for game to be created
        gameId = await gameFoundPromise;

        console.log(`Game ID: ${gameId}`);

        // Join game promises
        const gameStartPromise = Promise.all([
            new Promise<void>(resolve => {
                clientSocket1.on('gameUpdate', game => {
                    if (game.status === 'playing') resolve();
                });
            }),
            new Promise<void>(resolve => {
                clientSocket2.on('gameUpdate', game => {
                    if (game.status === 'playing') resolve();
                });
            })
        ]);

        // Join the game
        clientSocket1.emit('joinGame', { gameId });
        clientSocket2.emit('joinGame', { gameId });

        // Wait for game to start
        await gameStartPromise;

        // Play winning sequence
        const moves = [
            { socket: clientSocket1, pos: 0 }, // X
            { socket: clientSocket2, pos: 3 }, // O
            { socket: clientSocket1, pos: 1 }, // X
            { socket: clientSocket2, pos: 4 }, // O
            { socket: clientSocket1, pos: 2 }, // X wins
        ];

        // Make moves and wait for game end
        const gameEndPromise = new Promise<any>(resolve => {
            clientSocket1.on('gameUpdate', game => {
                if (game.status === 'finished') resolve(game);
            });
        });

        for (const move of moves) {
            move.socket.emit('makeMove', { gameId, position: move.pos });
            // Wait a bit between moves to ensure proper order
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        const finalGame = await gameEndPromise;
        expect(finalGame.winner).toBe(clientSocket1.id);
    });

    test('errors - should prevent invalid moves', async () => {
        // Set up game
        const gameFoundPromise = new Promise<string>(resolve => {
            clientSocket1.on('gameFound', resolve);
        });

        clientSocket1.emit('joinQueue', 'Player1');
        clientSocket2.emit('joinQueue', 'Player2');

        const gameId = await gameFoundPromise;

        // Join game and wait for it to start
        const gameStartPromise = new Promise<void>(resolve => {
            clientSocket1.on('gameUpdate', game => {
                if (game.status === 'playing') resolve();
            });
        });

        clientSocket1.emit('joinGame', { gameId });
        clientSocket2.emit('joinGame', { gameId });

        await gameStartPromise;

        // Try invalid move and expect error
        const errorPromise = new Promise<string>(resolve => {
            clientSocket2.on('error', resolve);
        });

        clientSocket2.emit('makeMove', { gameId, position: 0 });

        const errorMessage = await errorPromise;
        expect(errorMessage).toBe('Not your turn');
    });

    test('disconnection - should handle player disconnect', async () => {
        // Set up game
        const gameFoundPromise = new Promise<string>(resolve => {
            clientSocket1.on('gameFound', resolve);
        });

        clientSocket1.emit('joinQueue', 'Player1');
        clientSocket2.emit('joinQueue', 'Player2');

        const gameId = await gameFoundPromise;

        // Join game and wait for it to start
        const gameStartPromise = new Promise<void>(resolve => {
            clientSocket1.on('gameUpdate', game => {
                if (game.status === 'playing') resolve();
            });
        });

        clientSocket1.emit('joinGame', { gameId });
        clientSocket2.emit('joinGame', { gameId });

        await gameStartPromise;

        // Disconnect player 1 and check game ends
        const gameEndPromise = new Promise<any>(resolve => {
            clientSocket2.on('gameUpdate', game => {
                if (game.status === 'finished') resolve(game);
            });
        });

        clientSocket1.disconnect();

        const finalGame = await gameEndPromise;
        expect(finalGame.winner).toBe(clientSocket2.id);
    });
}, {
    timeout: 30000
});