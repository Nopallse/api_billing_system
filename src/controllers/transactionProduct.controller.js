// transactionProduct.controller.js
const { Transaction, Product, TransactionProduct } = require("../models");
const { v4: uuidv4 } = require("uuid");

// Helper function to update transaction total cost
const updateTransactionCost = async (transactionId) => {
    const transaction = await Transaction.findByPk(transactionId);
    if (!transaction) return;

    // Calculate total products cost
    const transactionProducts = await TransactionProduct.findAll({
        where: { transactionId }
    });
    
    const productsCost = transactionProducts.reduce((sum, tp) => sum + tp.subtotal, 0);
    
    // Update transaction cost (original duration cost + products cost)
    // Note: Jika transaction memiliki originalCost atau baseCost, gunakan itu
    // Untuk sekarang, kita asumsikan cost sudah termasuk duration cost
    await transaction.update({
        cost: (transaction.cost || 0) + productsCost
    });
};

// Fungsi untuk menambahkan produk ke transaksi aktif
const addProductToTransaction = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { productId, quantity = 1 } = req.body;

        // Validasi input
        if (!productId) {
            return res.status(400).json({
                message: 'Product ID wajib diisi'
            });
        }

        if (quantity < 1) {
            return res.status(400).json({
                message: 'Quantity harus lebih dari 0'
            });
        }

        // Cek apakah transaksi ada dan aktif
        const transaction = await Transaction.findByPk(transactionId);
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        // Cek apakah transaksi masih aktif (belum selesai)
        if (transaction.status === 'completed' || transaction.status === 'cancelled') {
            return res.status(400).json({
                message: 'Tidak dapat menambahkan produk ke transaksi yang sudah selesai atau dibatalkan'
            });
        }

        // Cek apakah produk ada
        const product = await Product.findByPk(productId);
        if (!product) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan'
            });
        }

        // Hitung subtotal
        const subtotal = product.price * quantity;

        // Buat TransactionProduct
        const transactionProduct = await TransactionProduct.create({
            id: uuidv4(),
            transactionId: transactionId,
            productId: productId,
            quantity: quantity,
            price: product.price, // Simpan harga saat ini untuk riwayat
            subtotal: subtotal
        });

        // Update transaction total cost
        const currentCost = transaction.cost || 0;
        await transaction.update({
            cost: currentCost + subtotal
        });

        // Load product data untuk response
        await transactionProduct.reload({
            include: [{
                model: Product,
                as: 'product'
            }]
        });

        return res.status(201).json({
            message: 'Produk berhasil ditambahkan ke transaksi',
            data: transactionProduct
        });
    } catch (error) {
        console.error('Error adding product to transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Fungsi untuk mendapatkan produk dalam transaksi
const getTransactionProducts = async (req, res) => {
    try {
        const { transactionId } = req.params;

        const transaction = await Transaction.findByPk(transactionId);
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        const transactionProducts = await TransactionProduct.findAll({
            where: {
                transactionId: transactionId
            },
            include: [{
                model: Product,
                as: 'product'
            }],
            order: [['createdAt', 'ASC']]
        });

        // Hitung total produk
        const productsTotal = transactionProducts.reduce((sum, tp) => sum + tp.subtotal, 0);

        return res.status(200).json({
            message: 'Success',
            data: {
                products: transactionProducts,
                productsTotal: productsTotal,
                productsCount: transactionProducts.length
            }
        });
    } catch (error) {
        console.error('Error getting transaction products:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Fungsi untuk menghapus produk dari transaksi
const removeProductFromTransaction = async (req, res) => {
    try {
        const { transactionId, productTransactionId } = req.params;

        // Cek apakah transaksi ada dan aktif
        const transaction = await Transaction.findByPk(transactionId);
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        // Cek apakah transaksi masih aktif
        if (transaction.status === 'completed' || transaction.status === 'cancelled') {
            return res.status(400).json({
                message: 'Tidak dapat menghapus produk dari transaksi yang sudah selesai atau dibatalkan'
            });
        }

        // Cek apakah TransactionProduct ada
        const transactionProduct = await TransactionProduct.findOne({
            where: {
                id: productTransactionId,
                transactionId: transactionId
            }
        });

        if (!transactionProduct) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan dalam transaksi'
            });
        }

        // Store subtotal before deleting untuk update transaction cost
        const removedSubtotal = transactionProduct.subtotal;

        await transactionProduct.destroy();

        // Update transaction cost - kurangi subtotal yang dihapus
        const currentCost = transaction.cost || 0;
        await transaction.update({
            cost: Math.max(0, currentCost - removedSubtotal) // Prevent negative cost
        });

        return res.status(200).json({
            message: 'Produk berhasil dihapus dari transaksi'
        });
    } catch (error) {
        console.error('Error removing product from transaction:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Fungsi untuk update quantity produk dalam transaksi
const updateTransactionProductQuantity = async (req, res) => {
    try {
        const { transactionId, productTransactionId } = req.params;
        const { quantity } = req.body;

        // Validasi input
        if (!quantity || quantity < 1) {
            return res.status(400).json({
                message: 'Quantity harus lebih dari 0'
            });
        }

        // Cek apakah transaksi ada dan aktif
        const transaction = await Transaction.findByPk(transactionId);
        if (!transaction) {
            return res.status(404).json({
                message: 'Transaksi tidak ditemukan'
            });
        }

        // Cek apakah transaksi masih aktif
        if (transaction.status === 'completed' || transaction.status === 'cancelled') {
            return res.status(400).json({
                message: 'Tidak dapat mengupdate produk dari transaksi yang sudah selesai atau dibatalkan'
            });
        }

        // Cek apakah TransactionProduct ada
        const transactionProduct = await TransactionProduct.findOne({
            where: {
                id: productTransactionId,
                transactionId: transactionId
            },
            include: [{
                model: Product,
                as: 'product'
            }]
        });

        if (!transactionProduct) {
            return res.status(404).json({
                message: 'Produk tidak ditemukan dalam transaksi'
            });
        }

        // Store old subtotal before updating
        const oldSubtotal = transactionProduct.subtotal;

        // Update quantity dan subtotal
        const newSubtotal = transactionProduct.price * quantity;
        await transactionProduct.update({
            quantity: quantity,
            subtotal: newSubtotal
        });

        // Update transaction cost - adjust by difference
        const currentCost = transaction.cost || 0;
        const costDifference = newSubtotal - oldSubtotal;
        await transaction.update({
            cost: currentCost + costDifference
        });

        // Reload untuk mendapatkan data terbaru
        await transactionProduct.reload({
            include: [{
                model: Product,
                as: 'product'
            }]
        });

        return res.status(200).json({
            message: 'Quantity produk berhasil diupdate',
            data: transactionProduct
        });
    } catch (error) {
        console.error('Error updating transaction product quantity:', error);
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
};

module.exports = {
    addProductToTransaction,
    getTransactionProducts,
    removeProductFromTransaction,
    updateTransactionProductQuantity
};
