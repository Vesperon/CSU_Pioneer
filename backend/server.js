const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');
const http = require('http');
const chess = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

const JWT_SECRET = 'your_jwt_secret_key';

// Mock database
const users = [];
const games = {};

// Helper function for ELO calculation
function calculateElo(player1, player2, result) {
    const K = 32;
    const expectedScore1 = 1 / (1 + Math.pow(10, (player2.elo - player1.elo) / 400));
    const expectedScore2 = 1 - expectedScore1;

    const score1 = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5;
    const score2 = 1 - score1;

    player1.elo += K * (score1 - expectedScore1);
    player2.elo += K * (score2 - expectedScore2);
}

// Authentication Routes
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (users.find(user => user.username === username)) {
        return res.status(400).json({ message: 'Username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword, elo: 1200, wins: 0, losses: 0, gamesPlayed: 0 });
    res.json({ message: 'User registered' });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(user => user.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});

app.get('/profile', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
        const { username } = jwt.verify(token, JWT_SECRET);
        const user = users.find(user => user.username === username);
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch {
        res.status(401).json({ message: 'Invalid token' });
    }
});

// Real-time Game Logic
io.on('connection', (socket) => {
    socket.on('join_game', ({ gameId, username }) => {
        if (!games[gameId]) {
            games[gameId] = { board: new chess.Chess(), players: [] };
        }
        const game = games[gameId];
        if (!game.players.includes(username)) {
            game.players.push(username);
        }
        socket.join(gameId);
        io.to(gameId).emit('game_update', { fen: game.board.fen(), players: game.players });
    });

    socket.on('make_move', ({ gameId, move }) => {
        const game = games[gameId];
        if (game && game.board.move(move)) {
            io.to(gameId).emit('game_update', { fen: game.board.fen(), players: game.players });
        } else {
            socket.emit('invalid_move');
        }
    });

    socket.on('end_game', ({ gameId, winner }) => {
        const game = games[gameId];
        if (!game) return;

        const [player1, player2] = game.players.map(username =>
            users.find(user => user.username === username)
        );

        if (winner === player1.username) {
            player1.wins += 1;
            player2.losses += 1;
        } else {
            player2.wins += 1;
            player1.losses += 1;
        }

        player1.gamesPlayed += 1;
        player2.gamesPlayed += 1;

        calculateElo(player1, player2, winner === player1.username ? 'win' : 'loss');
        delete games[gameId];

        io.to(gameId).emit('game_ended', { winner, player1, player2 });
    });
});

server.listen(4000, () => console.log('Server running on http://localhost:4000'));
