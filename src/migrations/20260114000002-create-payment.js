'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('Payments', {
            id: {
                allowNull: false,
                primaryKey: true,
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4
            },
            shiftId: {
                type: Sequelize.UUID,
                allowNull: false,
                references: {
                    model: 'Shifts',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'CASCADE'
            },
            userId: {
                type: Sequelize.UUID,
                allowNull: false,
                comment: 'User/Cashier who processed this payment'
            },
            transactionId: {
                type: Sequelize.UUID,
                allowNull: true,
                references: {
                    model: 'Transactions',
                    key: 'id'
                },
                onUpdate: 'CASCADE',
                onDelete: 'SET NULL',
                comment: 'Optional: Payment might not be linked to a transaction (e.g. general income)'
            },
            amount: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            type: {
                type: Sequelize.ENUM('RENTAL', 'FNB', 'PENALTY', 'TOPUP', 'OTHER'),
                allowNull: false,
                defaultValue: 'RENTAL'
            },
            paymentMethod: {
                type: Sequelize.ENUM('CASH', 'QRIS', 'TRANSFER', 'DEBIT', 'CREDIT'),
                allowNull: false,
                defaultValue: 'CASH'
            },
            note: {
                type: Sequelize.TEXT,
                allowNull: true
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

        await queryInterface.addIndex('Payments', ['shiftId']);
        await queryInterface.addIndex('Payments', ['transactionId']);
    },
    async down(queryInterface, Sequelize) {
        await queryInterface.dropTable('Payments');
    }
};
