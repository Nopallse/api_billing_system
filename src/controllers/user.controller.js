const { User } = require('../models');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Get all users
const getAllUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: { exclude: ['password', 'token'] }, // Exclude sensitive data
            order: [['createdAt', 'DESC']]
        });

        return res.status(200).json({
            message: 'Data user berhasil diambil',
            data: users
        });
    } catch (error) {
        console.error('Get all users error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

// Block/Unblock user (toggle isActive)
const blockUser = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ message: 'ID user harus disediakan' });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: 'User tidak ditemukan' });
        }

        // Toggle isActive status
        const newStatus = !user.isActive;
        await User.update(
            { isActive: newStatus },
            { where: { id: userId } }
        );

        const statusText = newStatus ? 'diaktifkan' : 'diblokir';

        return res.status(200).json({
            message: `User berhasil ${statusText}`,
            data: {
                id: user.id,
                username: user.username,
                email: user.email,
                type: user.type,
                isActive: newStatus
            }
        });
    } catch (error) {
        console.error('Block user error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

// Create new user (moved from auth controller)
const createUser = async (req, res) => {
    try {
        const { username, email, password, type = 'user' } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ message: 'Email dan password harus diisi' });
        }

        // Cek apakah email sudah terdaftar
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'Email sudah terdaftar' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = uuidv4();
        
        const user = await User.create({ 
            id: userId,
            username: username || email.split('@')[0], // Default username dari email jika tidak diisi
            email, 
            password: hashedPassword, 
            type: type
        });
        
        // Hapus password dari response
        const userData = user.toJSON();
        delete userData.password;
        
        return res.status(201).json({ 
            message: 'User berhasil dibuat',
            data: userData
        });
    } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

// Get user by ID
const getUserById = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).json({ message: 'ID user harus disediakan' });
        }

        const user = await User.findByPk(userId, {
            attributes: { exclude: ['password', 'token'] }
        });

        if (!user) {
            return res.status(404).json({ message: 'User tidak ditemukan' });
        }

        return res.status(200).json({
            message: 'Data user berhasil diambil',
            data: user
        });
    } catch (error) {
        console.error('Get user by ID error:', error);
        return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    }
};

module.exports = {
    getAllUsers,
    blockUser,
    createUser,
    getUserById
};
