'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class Shift extends Model {
        static associate(models) {
            Shift.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
            Shift.hasMany(models.Payment, { foreignKey: 'shiftId', as: 'payments' });
        }
    }
    Shift.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            allowNull: false,
            primaryKey: true,
        },
        userId: DataTypes.UUID,
        startTime: DataTypes.DATE,
        endTime: DataTypes.DATE,
        initialCash: {
            type: DataTypes.INTEGER,
            defaultValue: 0
        },
        finalCash: DataTypes.INTEGER,
        expectedCash: DataTypes.INTEGER,
        status: {
            type: DataTypes.ENUM('open', 'closed'),
            defaultValue: 'open'
        },
        note: DataTypes.TEXT
    }, {
        sequelize,
        modelName: 'Shift',
    });
    return Shift;
};
