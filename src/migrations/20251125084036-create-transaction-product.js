'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('TransactionProducts', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4
            },
            transactionId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'Transactions',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            productId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'Products',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            quantity: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 1
            },
            price: {
                type: Sequelize.INTEGER,
                allowNull: false,
                comment: 'Harga produk saat transaksi (untuk riwayat)'
            },
            subtotal: {
                type: Sequelize.INTEGER,
                allowNull: false,
                comment: 'quantity * price'
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        // Tambahkan index untuk performa query
        await queryInterface.addIndex('TransactionProducts', ['transactionId']);
        await queryInterface.addIndex('TransactionProducts', ['productId']);
    },

    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('TransactionProducts');
    }
};