const { Transaction, Device } = require('./src/models');

async function finishEndedTransactions() {
    try {
        console.log('Starting to finish ended transactions...');
        
        // Cari semua device dengan timerStatus 'end' yang masih memiliki transaksi aktif
        const endedDevices = await Device.findAll({
            where: {
                timerStatus: 'end'
            },
            include: [{
                model: Transaction,
                where: { end: null }, // Transaksi yang belum selesai
                required: true
            }]
        });

        console.log(`Found ${endedDevices.length} devices with ended timers but active transactions`);

        for (const device of endedDevices) {
            for (const transaction of device.Transactions) {
                // Hitung end time berdasarkan start + duration
                const startTime = new Date(device.timerStart || new Date());
                const endTime = new Date(startTime.getTime() + (transaction.duration * 1000));
                
                // Update transaksi dengan end time
                await transaction.update({
                    end: endTime
                });

                console.log(`✅ Finished transaction ${transaction.id} for device ${device.id}`);
            }
        }

        console.log('✅ All ended transactions have been finished');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error finishing ended transactions:', error);
        process.exit(1);
    }
}

finishEndedTransactions();