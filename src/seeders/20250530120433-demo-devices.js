'use strict';
const { v4: uuidv4 } = require('uuid');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Dapatkan ID kategori yang sudah ada
    const categories = await queryInterface.sequelize.query(
      'SELECT id, categoryName from Categories;',
      { type: queryInterface.sequelize.QueryTypes.SELECT }
    );

    const ps4Category = categories.find(c => c.categoryName === 'PS4 Standard - 1 Jam');
    const ps5Category = categories.find(c => c.categoryName === 'PS5 Standard - 1 Jam');

    return queryInterface.bulkInsert('Devices', [{
      id: uuidv4(),
      name: 'PS4-01',
      categoryId: ps4Category.id,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: uuidv4(),
      name: 'PS4-02',
      categoryId: ps4Category.id,
      createdAt: new Date(),
      updatedAt: new Date()
    }, {
      id: uuidv4(),
      name: 'PS5-01',
      categoryId: ps5Category.id,
      createdAt: new Date(),
      updatedAt: new Date()
    }]);
  },

  async down (queryInterface, Sequelize) {
    return queryInterface.bulkDelete('Devices', null, {});
  }
};