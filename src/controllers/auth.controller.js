const {User}= require('../models')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
//a
// login Admin
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ message: 'Email dan password harus diisi' });
        }
        

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ message: 'Email atau password salah' });
        }

        const isActive = user.isActive;
        if (!isActive) {
            return res.status(401).json({ message: 'User tidak aktif' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Email atau password salah' });
        }

        // Generate tokens
        const accessToken = jwt.sign(
            { 
                id: user.id, 
                email: user.email,
                type: user.type // Tambahkan type user ke token
            }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
        );

        const refreshToken = jwt.sign(
            { 
                id: user.id,
                type: user.type
            },
            JWT_REFRESH_SECRET,
            { expiresIn: '7d' }
        );

        // Update refresh token di database
        await User.update(
            { token: refreshToken },
            { where: { id: user.id } }
        );

        return res.status(200).json({
            message: 'Login berhasil',
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    type: user.type
                },
                accessToken,
                refreshToken
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
}



const refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ message: 'Refresh token harus disediakan' });
        }

        // Cari user berdasarkan refresh token
        const user = await User.findOne({ where: { token: refreshToken } });
        if (!user) {
            return res.status(401).json({ message: 'Refresh token tidak valid' });
        }

        // Verify refresh token
        const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        
        // Generate new access token only
        const accessToken = jwt.sign(
            { 
                id: user.id, 
                email: user.email,
                type: user.type
            }, 
            JWT_SECRET, 
            { expiresIn: '1h' }
        );

        return res.status(200).json({
            message: 'Access token berhasil diperbarui',
            data: {
                accessToken
            }
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Refresh token sudah kadaluarsa' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Refresh token tidak valid' });
        }
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

// Return currently authenticated user profile
const getProfile = async (req, res) => {
    try {
        // `tokenValidation` middleware attaches the user to the request
        const user = req.user;

        if (!user) {
            return res.status(401).json({ message: 'User tidak ditemukan' });
        }

        return res.status(200).json({
            message: 'Profil berhasil diambil',
            data: {
                id: user.id,
                username: user.username,
                email: user.email,
                type: user.type,
                isActive: user.isActive
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

module.exports = {
    login,
    refreshToken,
    getProfile
};