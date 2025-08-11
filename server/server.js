const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://mindlinktelepathy.netlify.app",
        methods: ["GET", "POST"]
    }
});
const port = process.env.PORT || 3000;

// Game state management
const games = {}; // Stores active game rooms

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.use(express.static(path.join(__dirname, '../client')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('create_game', (data) => {
        const { playerName, totalRounds } = data;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let gameCode = '';
        for (let i = 0; i < 4; i++) {
            gameCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        if (!games[gameCode]) {
            games[gameCode] = {
                players: [{ id: socket.id, name: playerName }],
                state: 'waiting',
                prompt: null,
                responses: {},
                imageSeed: null,
                currentRound: 1,
                totalRounds: totalRounds,
                scores: {}
            };
            games[gameCode].scores[socket.id] = 0;
            socket.join(gameCode);
            socket.emit('game_created', { gameCode });
            console.log(`Game created with code: ${gameCode} by ${playerName}`);
        } else {
            socket.emit('create_game_error', { message: 'Game code already exists' });
        }
    });

    socket.on('join_game', (data) => {
        const { gameCode, playerName } = data;
        const game = games[gameCode];

        if (game && game.players.length === 1) {
            game.players.push({ id: socket.id, name: playerName });
            game.scores[socket.id] = 0;
            game.state = 'playing';
            socket.join(gameCode);
            
            const player1Name = game.players[0].name;
            const player2Name = game.players[1].name;
            io.to(gameCode).emit('game_started', { 
                player1: player1Name, 
                player2: player2Name
            });

            startNewRound(gameCode);
            console.log(`Player ${playerName} joined game ${gameCode}`);
        } else {
            socket.emit('join_game_error', { message: 'Invalid game code or game is full' });
        }
    });

    socket.on('submit_word', (data) => {
        const { gameCode, word } = data;
        const game = games[gameCode];

        if (game && game.responses[socket.id] === undefined) {
            game.responses[socket.id] = word;
            
            if (Object.keys(game.responses).length === 2) {
                endRound(gameCode);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const code in games) {
            games[code].players = games[code].players.filter(player => player.id !== socket.id);
            if (games[code].players.length === 0) {
                delete games[code];
                console.log(`Game room ${code} deleted.`);
            } else {
                io.to(code).emit('player_disconnected');
            }
        }
    });
});

async function startNewRound(gameCode) {
    const game = games[gameCode];
    if (game) {
        game.responses = {};

        // Generate the seed only once per round and store it
        game.imageSeed = Math.floor(Math.random() * 100000);
        const imageUrl = `https://picsum.photos/400/300?random=${game.imageSeed}`;

        game.prompt = imageUrl;
        io.to(gameCode).emit('new_round', { prompt: imageUrl, currentRound: game.currentRound });

        setTimeout(() => {
            if (game.state === 'playing') {
                endRound(gameCode);
            }
        }, 30000);
    }
}

function endRound(gameCode) {
    const game = games[gameCode];
    if (game && game.state === 'playing') {
        const [player1Id, player2Id] = game.players.map(p => p.id);
        const [player1Word, player2Word] = [game.responses[player1Id], game.responses[player2Id]];

        let match = false;
        if (player1Word && player2Word && player1Word.toLowerCase() === player2Word.toLowerCase()) {
            match = true;
            game.scores[player1Id]++;
            game.scores[player2Id]++;
        }

        io.to(gameCode).emit('round_over', {
            match,
            player1Word: player1Word || 'No response',
            player2Word: player2Word || 'No response'
        });

        game.currentRound++;

        if (game.currentRound > game.totalRounds) {
            setTimeout(() => {
                const totalScore = Object.values(game.scores).reduce((sum, score) => sum + score, 0);
                const totalPossibleScore = game.totalRounds * 2;
                const similarityPercentage = (totalScore / totalPossibleScore) * 100;
                io.to(gameCode).emit('game_over', {
                    similarity: similarityPercentage.toFixed(0)
                });
                delete games[gameCode];
            }, 3000);
        } else {
            setTimeout(() => startNewRound(gameCode), 3000);
        }
    }
}

server.listen(port, () => {
    console.log(`MindLink server running on http://localhost:${port}`);
});
