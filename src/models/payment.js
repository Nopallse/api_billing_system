'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class Payment extends Model {
        static associate(models) {
            Payment.belongsTo(models.Shift, { foreignKey: 'shiftId', as: 'shift' });
            Payment.belongsTo(models.Transaction, { foreignKey: 'transactionId', as: 'transaction' });
            Payment.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
        }
    }
    Payment.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            allowNull: false,
            primaryKey: true,
        },
        shiftId: DataTypes.UUID,
        userId: DataTypes.UUID,
        transactionId: DataTypes.UUID,
        amount: DataTypes.INTEGER,
        type: {
            type: DataTypes.ENUM('RENTAL', 'FNB', 'PENALTY', 'TOPUP', 'OTHER'),
            defaultValue: 'RENTAL'
        },
        paymentMethod: {
            type: DataTypes.ENUM('CASH', 'QRIS', 'TRANSFER', 'DEBIT', 'CREDIT'),
            defaultValue: 'CASH'
        },
        note: DataTypes.TEXT
    }, {
        sequelize,
        modelName: 'Payment',
    });
    return Payment;
};
