const { Product } = require('../models');
const { v4: uuidv4 } = require('uuid');

// Tambah Product
const createProduct = async (req, res) => {
    const { name, description, price } = req.body;
    try {
        // Validasi input
        if (!name || !price) {
            return res.status(400).json({
                message: 'Nama dan harga produk wajib diisi'
            });
        }

        if (price < 0) {
            return res.status(400).json({
                message: 'Harga tidak boleh negatif'
            });
        }

        const productId = uuidv4();
        const product = await Product.create({
            id: productId,
            name,
            description: description || null,
            price: parseInt(price)
        });

        res.status(201).json({
            message: 'Produk berhasil dibuat',
            data: product
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get All Products
const getAllProducts = async (req, res) => {
    try {
        const products = await Product.findAll({
            order: [['createdAt', 'DESC']]
        });
        res.status(200).json({
            message: 'Success',
            data: products
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get Product By ID
const getProductById = async (req, res) => {
    const { id } = req.params;
    try {
        const product = await Product.findByPk(id);
        if (!product) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan'
            });
        }
        res.status(200).json({
            message: 'Success',
            data: product
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Update Product
const updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, description, price } = req.body;
    try {
        const product = await Product.findByPk(id);
        if (!product) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan'
            });
        }

        // Validasi harga jika diupdate
        if (price !== undefined && price < 0) {
            return res.status(400).json({
                message: 'Harga tidak boleh negatif'
            });
        }

        // Update product
        if (name !== undefined) product.name = name;
        if (description !== undefined) product.description = description;
        if (price !== undefined) product.price = parseInt(price);

        await product.save();

        res.status(200).json({
            message: 'Produk berhasil diupdate',
            data: product
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Delete Product
const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const product = await Product.findByPk(id);
        if (!product) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan'
            });
        }

        await product.destroy();
        res.status(200).json({
            message: 'Produk berhasil dihapus'
        });
    } catch (error) {
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

module.exports = {
    createProduct,
    getAllProducts,
    getProductById,
    updateProduct,
    deleteProduct
};
