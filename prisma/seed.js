import { PrismaClient } from '@prisma/client';
import { scryptSync, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// Hash a passkey with scrypt -> "salt:hash" hex (matches server.js verifyPasskey/hashPasskey)
function hashPasskey(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('Clearing database tables...');
  
  // Wipe tables in reverse dependency order
  await prisma.staff.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.financialLog.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.productionLog.deleteMany();
  await prisma.b2bPartner.deleteMany();
  await prisma.fifoBatch.deleteMany();
  await prisma.recipeItem.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.product.deleteMany();

  console.log('Seeding products...');
  const p1 = await prisma.product.create({
    data: { name: 'Creamy Bun', category: 'buns', retailPrice: 120.0, wholesalePrice: 90.0, shelfLife: 4, icon: 'fa-cookie-bite', dailyTarget: 300 }
  });
  const p2 = await prisma.product.create({
    data: { name: 'Coconut Bun', category: 'buns', retailPrice: 150.0, wholesalePrice: 110.0, shelfLife: 4, icon: 'fa-bread-slice', dailyTarget: 200 }
  });
  const p3 = await prisma.product.create({
    data: { name: 'Sandwich Bread', category: 'bread', retailPrice: 280.0, wholesalePrice: 210.0, shelfLife: 5, icon: 'fa-square', dailyTarget: 150 }
  });

  console.log('Seeding ingredients...');
  const i1 = await prisma.ingredient.create({
    data: { code: 'i1', name: "Baker's Flour", stock: 250000.0, unit: 'g', threshold: 50000.0, unitCost: 150.0, isPerishable: false }
  });
  const i2 = await prisma.ingredient.create({
    data: { code: 'i2', name: 'Refined Sugar', stock: 80000.0, unit: 'g', threshold: 15000.0, unitCost: 250.0, isPerishable: false }
  });
  const i3 = await prisma.ingredient.create({
    data: { code: 'i3', name: 'Fresh Dairy Butter', stock: 22000.0, unit: 'g', threshold: 5000.0, unitCost: 2200.0, isPerishable: true }
  });
  const i4 = await prisma.ingredient.create({
    data: { code: 'i4', name: 'Desiccated Coconut', stock: 15000.0, unit: 'g', threshold: 3000.0, unitCost: 800.0, isPerishable: false }
  });
  const i5 = await prisma.ingredient.create({
    data: { code: 'i5', name: 'Fresh Yeast Active', stock: 4500.0, unit: 'g', threshold: 1000.0, unitCost: 500.0, isPerishable: true }
  });

  console.log('Linking Bill of Materials (BOM Recipes)...');
  // Creamy Bun recipe: 50g Flour, 10g Sugar, 5g Butter
  await prisma.recipeItem.create({ data: { productId: p1.id, ingredientId: i1.id, quantityGrams: 50.0 } });
  await prisma.recipeItem.create({ data: { productId: p1.id, ingredientId: i2.id, quantityGrams: 10.0 } });
  await prisma.recipeItem.create({ data: { productId: p1.id, ingredientId: i3.id, quantityGrams: 5.0 } });
  
  // Coconut Bun recipe: 60g Flour, 15g Sugar, 8g Butter, 20g Coconut
  await prisma.recipeItem.create({ data: { productId: p2.id, ingredientId: i1.id, quantityGrams: 60.0 } });
  await prisma.recipeItem.create({ data: { productId: p2.id, ingredientId: i2.id, quantityGrams: 15.0 } });
  await prisma.recipeItem.create({ data: { productId: p2.id, ingredientId: i3.id, quantityGrams: 8.0 } });
  await prisma.recipeItem.create({ data: { productId: p2.id, ingredientId: i4.id, quantityGrams: 20.0 } });

  // Sandwich Bread recipe: 120g Flour, 5g Sugar, 10g Butter, 2g Yeast
  await prisma.recipeItem.create({ data: { productId: p3.id, ingredientId: i1.id, quantityGrams: 120.0 } });
  await prisma.recipeItem.create({ data: { productId: p3.id, ingredientId: i2.id, quantityGrams: 5.0 } });
  await prisma.recipeItem.create({ data: { productId: p3.id, ingredientId: i3.id, quantityGrams: 10.0 } });
  await prisma.recipeItem.create({ data: { productId: p3.id, ingredientId: i5.id, quantityGrams: 2.0 } });

  console.log('Seeding perishable FIFO Batch Queue...');
  await prisma.fifoBatch.create({
    data: { batchCode: 'f-101', ingredientId: i3.id, dateReceived: '2026-05-20', originalQty: 10000.0, remainingQty: 2000.0, expiryDate: '2026-05-27' }
  });
  await prisma.fifoBatch.create({
    data: { batchCode: 'f-102', ingredientId: i3.id, dateReceived: '2026-05-24', originalQty: 20000.0, remainingQty: 20000.0, expiryDate: '2026-05-31' }
  });
  await prisma.fifoBatch.create({
    data: { batchCode: 'f-103', ingredientId: i5.id, dateReceived: '2026-05-18', originalQty: 2000.0, remainingQty: 500.0, expiryDate: '2026-05-25' }
  });
  await prisma.fifoBatch.create({
    data: { batchCode: 'f-104', ingredientId: i5.id, dateReceived: '2026-05-25', originalQty: 4000.0, remainingQty: 4000.0, expiryDate: '2026-06-01' }
  });

  console.log('Seeding B2B corporate wholesale partners...');
  const b1 = await prisma.b2bPartner.create({
    data: { name: 'Keells Supermarket Group', address: 'No. 11, Sir Chittampalam A. Gardiner Mawatha, Colombo 02', terms: 30, limit: 150000.0, balance: 65000.0 }
  });
  const b2 = await prisma.b2bPartner.create({
    data: { name: 'Cargills Food City PLC', address: 'No. 40, York Street, Colombo 01', terms: 60, limit: 250000.0, balance: 140000.0 }
  });
  const b3 = await prisma.b2bPartner.create({
    data: { name: 'The Daily Grind Cafe', address: 'Green Path, Colombo 03', terms: 30, limit: 50000.0, balance: 15000.0 }
  });

  console.log('Seeding completed production batches...');
  await prisma.productionLog.create({
    data: { batchCode: 'BCH-1001', productId: p1.id, quantity: 200, dateProduced: '2026-05-22', expiryDate: '2026-05-26', active: true }
  });
  await prisma.productionLog.create({
    data: { batchCode: 'BCH-1002', productId: p3.id, quantity: 100, dateProduced: '2026-05-24', expiryDate: '2026-05-29', active: true }
  });
  await prisma.productionLog.create({
    data: { batchCode: 'BCH-1003', productId: p2.id, quantity: 150, dateProduced: '2026-05-25', expiryDate: '2026-05-29', active: true }
  });

  console.log('Seeding invoices and invoice items...');
  const inv1 = await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-2026-0001',
      customerType: 'B2B',
      partnerId: b1.id,
      customerName: b1.name,
      date: '2026-05-02',
      dueDate: '2026-06-01',
      total: 85000.0,
      discount: 20000.0,
      grandTotal: 65000.0,
      method: 'credit',
      outstanding: 65000.0,
      paidAmount: 0.0,
      status: 'Unpaid'
    }
  });
  await prisma.invoiceItem.create({ data: { invoiceId: inv1.id, productName: 'Creamy Bun', quantity: 500, retailPrice: 120.0, wholesalePrice: 90.0 } });
  await prisma.invoiceItem.create({ data: { invoiceId: inv1.id, productName: 'Sandwich Bread', quantity: 100, retailPrice: 280.0, wholesalePrice: 210.0 } });

  const inv2 = await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-2026-0002',
      customerType: 'B2B',
      partnerId: b2.id,
      customerName: b2.name,
      date: '2026-04-12',
      dueDate: '2026-06-11',
      total: 120000.0,
      discount: 30000.0,
      grandTotal: 90000.0,
      method: 'credit',
      outstanding: 90000.0,
      paidAmount: 0.0,
      status: 'Unpaid'
    }
  });
  await prisma.invoiceItem.create({ data: { invoiceId: inv2.id, productName: 'Creamy Bun', quantity: 1000, retailPrice: 120.0, wholesalePrice: 90.0 } });

  const inv3 = await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-2026-0003',
      customerType: 'B2B',
      partnerId: b2.id,
      customerName: b2.name,
      date: '2026-03-10',
      dueDate: '2026-05-09',
      total: 70000.0,
      discount: 20000.0,
      grandTotal: 50000.0,
      method: 'credit',
      outstanding: 50000.0,
      paidAmount: 0.0,
      status: 'Overdue' // Overdue since > 60 days
    }
  });
  await prisma.invoiceItem.create({ data: { invoiceId: inv3.id, productName: 'Coconut Bun', quantity: 466, retailPrice: 150.0, wholesalePrice: 110.0 } });

  const inv4 = await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-2026-0004',
      customerType: 'B2B',
      partnerId: b3.id,
      customerName: b3.name,
      date: '2026-05-24',
      dueDate: '2026-06-23',
      total: 20000.0,
      discount: 5000.0,
      grandTotal: 15000.0,
      method: 'credit',
      outstanding: 15000.0,
      paidAmount: 0.0,
      status: 'Unpaid'
    }
  });
  await prisma.invoiceItem.create({ data: { invoiceId: inv4.id, productName: 'Sandwich Bread', quantity: 71, retailPrice: 280.0, wholesalePrice: 210.0 } });

  const inv5 = await prisma.invoice.create({
    data: {
      invoiceNo: 'B2C-TXN-1001',
      customerType: 'B2C',
      customerName: 'Walk-in Retail Cash Guest',
      date: '2026-05-26',
      dueDate: '2026-05-26',
      total: 4800.0,
      discount: 0.0,
      grandTotal: 4800.0,
      method: 'cash',
      outstanding: 0.0,
      paidAmount: 4800.0,
      status: 'Paid'
    }
  });
  await prisma.invoiceItem.create({ data: { invoiceId: inv5.id, productName: 'Creamy Bun', quantity: 40, retailPrice: 120.0, wholesalePrice: 90.0 } });

  console.log('Seeding transaction log lines...');
  await prisma.financialLog.create({ data: { txnCode: 'TXN-5001', date: '2026-05-02', description: 'B2B Invoice Billing INV-2026-0001 (Credit Sale)', method: 'credit', amount: 65000.0 } });
  await prisma.financialLog.create({ data: { txnCode: 'TXN-5002', date: '2026-04-12', description: 'B2B Invoice Billing INV-2026-0002 (Credit Sale)', method: 'credit', amount: 90000.0 } });
  await prisma.financialLog.create({ data: { txnCode: 'TXN-5003', date: '2026-03-10', description: 'B2B Invoice Billing INV-2026-0003 (Credit Sale)', method: 'credit', amount: 50000.0 } });
  await prisma.financialLog.create({ data: { txnCode: 'TXN-5004', date: '2026-05-24', description: 'B2B Invoice Billing INV-2026-0004 (Credit Sale)', method: 'credit', amount: 15000.0 } });
  await prisma.financialLog.create({ data: { txnCode: 'TXN-5005', date: '2026-05-26', description: 'B2C Retail POS Checkout B2C-TXN-1001 (Cash)', method: 'cash', amount: 4800.0 } });

  console.log('Seeding default notifications...');
  await prisma.notification.create({ data: { type: 'danger', title: 'Expired FIFO Batch', desc: 'Fresh Yeast active batch f-103 expired on 2026-05-25.', time: new Date().toISOString(), isAudit: false } });
  await prisma.notification.create({ data: { type: 'warning', title: 'B2B Ledger Overdue', desc: 'Cargills Food City has an overdue balance of LKR 50,000.00 since 2026-05-09.', time: new Date().toISOString(), isAudit: false } });

  console.log('Seeding default Staff accounts (passkeys stored as scrypt hashes)...');
  await prisma.staff.create({ data: { username: 'anura', name: 'Anura Perera', role: 'admin', passkey: hashPasskey('anura123') } });
  await prisma.staff.create({ data: { username: 'sunil', name: 'Sunil Gamage', role: 'production', passkey: hashPasskey('sunil123') } });
  await prisma.staff.create({ data: { username: 'nisha', name: 'Nisha Fernando', role: 'sales', passkey: hashPasskey('nisha123') } });
  await prisma.staff.create({ data: { username: 'pradeep', name: 'Pradeep Silva', role: 'accountant', passkey: hashPasskey('pradeep123') } });
  await prisma.staff.create({ data: { username: 'kamal', name: 'Kamal Silva', role: 'delivery', passkey: hashPasskey('kamal123') } });

  console.log('Seeding global configuration...');
  await prisma.globalConfig.create({
    data: { id: 'global', defaultVAT: 8, defaultCreditLimit: 100000, autoPrintReceipt: false }
  });

  console.log('Database seeding successfully completed!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
