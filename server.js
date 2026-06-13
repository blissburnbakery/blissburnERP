/* ==========================================================================
   BLISSBURN ERP - PRODUCTION EXPRESS API SERVER (server.js)
   ========================================================================== */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { scryptSync, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5050;

// Security: Restrict CORS to known origins. The server's own runtime port is
// always allowed — hardcoding 5050 broke same-origin POSTs when PORT differed.
const ALLOWED_ORIGINS = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:5050',
    'http://localhost:3000',
    'http://127.0.0.1:5050',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (server-to-server, Postman, file://)
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('CORS: Origin not allowed'));
        }
    },
    credentials: true
}));

// Security: Body size limit to prevent payload attacks
app.use(express.json({ limit: '1mb' }));

// Security: Basic security headers (lightweight alternative to helmet)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.removeHeader('X-Powered-By');
    next();
});

// Security: Simple in-memory rate limiter (100 requests per minute per IP)
const rateLimitMap = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
    } else {
        const entry = rateLimitMap.get(ip);
        if (now > entry.resetTime) {
            entry.count = 1;
            entry.resetTime = now + windowMs;
        } else {
            entry.count++;
            if (entry.count > maxRequests) {
                return res.status(429).json({ error: 'Too many requests. Please try again later.' });
            }
        }
    }
    next();
});
// Clean up rate limit map every 5 minutes to prevent memory leak
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now > entry.resetTime) rateLimitMap.delete(ip);
    }
}, 300000);

// Serve only frontend assets — NOT the entire project directory
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ==========================================================================
   AUTHENTICATION: scrypt passkey hashing + bearer-token sessions
   ========================================================================== */

// Passkeys are stored as "salt:hash" (hex). Legacy plaintext rows are
// upgraded to this format transparently on first successful login.
function hashPasskey(plain) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(plain, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPasskey(plain, stored) {
    if (!stored.includes(':')) {
        return { ok: plain === stored, legacy: true };
    }
    const [salt, hash] = stored.split(':');
    const candidate = scryptSync(plain, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    const ok = candidate.length === expected.length && timingSafeEqual(candidate, expected);
    return { ok, legacy: false };
}

function sanitizeStaff(staff) {
    const { passkey, ...safe } = staff;
    return safe;
}

// In-memory session store: token -> { staffId, username, role, expiresAt }.
// A server restart just means staff sign in again.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [token, s] of sessions) {
        if (s.expiresAt < now) sessions.delete(token);
    }
}, 600000);

// Admin-only API surface
function isAdminOnlyRoute(req) {
    if (req.path.startsWith('/staff')) return true;                   // staff registry & CRUD
    if (req.method === 'PUT' && req.path === '/config') return true;  // global settings writes
    if (req.method === 'DELETE') return true;                         // all deletes are owner-level
    return false;
}

// Bearer-token guard for every /api route except login
app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const session = token ? sessions.get(token) : null;

    if (!session || session.expiresAt < Date.now()) {
        if (token) sessions.delete(token);
        return res.status(401).json({ error: 'Authentication required. Please sign in again.' });
    }

    if (isAdminOnlyRoute(req) && session.role !== 'admin') {
        return res.status(403).json({ error: 'Owner/Admin authorization is required for this operation.' });
    }

    req.staff = session;
    next();
});

// Helper: Calculate days between two ISO date strings
function getDaysDifference(date1Str, date2Str) {
    const d1 = new Date(date1Str);
    const d2 = new Date(date2Str);
    const diff = d2 - d1;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/* ==========================================================================
   1. PRODUCTS & INGREDIENTS API ROUTES
   ========================================================================== */

// GET: Retrieve all products
app.get('/api/products', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            include: {
                recipes: {
                    include: { ingredient: true }
                }
            }
        });
        res.json(products);
    } catch (e) {
        res.status(500).json({ error: 'Failed to retrieve products', details: e.message });
    }
});

// POST: Register a new product profile with custom BOM recipes (FR2)
app.post('/api/products', async (req, res) => {
    const { name, category, retailPrice, wholesalePrice, shelfLife, icon, bom } = req.body;
    
    if (!name || !category || retailPrice === undefined || wholesalePrice === undefined || !shelfLife || !icon || !bom) {
        return res.status(400).json({ error: 'Missing core product details or BOM recipe mapping' });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Verify product name uniqueness
            const existingProduct = await tx.product.findUnique({ where: { name } });
            if (existingProduct) {
                throw new Error(`Product with the name "${name}" already exists.`);
            }

            // 2. Create the Product record
            const newProduct = await tx.product.create({
                data: {
                    name,
                    category,
                    retailPrice: Number(retailPrice),
                    wholesalePrice: Number(wholesalePrice),
                    shelfLife: Number(shelfLife),
                    icon,
                    dailyTarget: Number(req.body.dailyTarget) || 100
                }
            });

            // 3. Create the join table links for BOM (RecipeItem)
            for (let code in bom) {
                const ingredient = await tx.ingredient.findUnique({ where: { code } });
                if (!ingredient) {
                    throw new Error(`Ingredient with code "${code}" not found in database.`);
                }
                
                await tx.recipeItem.create({
                    data: {
                        productId: newProduct.id,
                        ingredientId: ingredient.id,
                        quantityGrams: Number(bom[code])
                    }
                });
            }

            // 4. Post system audit notification
            await tx.notification.create({
                data: {
                    type: 'success',
                    title: 'New Product Configured',
                    desc: `Product ${name} created with B2C LKR ${retailPrice} and a custom BOM Card.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });

            return newProduct;
        });

        res.json({ success: true, product: result });
    } catch (e) {
        console.error('Product registration transaction failed, rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

// PUT: Update an existing product and its BOM recipe mapping atomically
app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { name, category, retailPrice, wholesalePrice, shelfLife, icon, bom } = req.body;

    if (!name || !category || retailPrice === undefined || wholesalePrice === undefined || !shelfLife || !icon || !bom) {
        return res.status(400).json({ error: 'Missing core product details or BOM recipe mapping' });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // 1. Verify the product exists
            const existingProduct = await tx.product.findUnique({ where: { id } });
            if (!existingProduct) {
                throw new Error('Product not found in database.');
            }

            // 2. If name is changing, check uniqueness of the new name
            if (name !== existingProduct.name) {
                const nameCheck = await tx.product.findUnique({ where: { name } });
                if (nameCheck) {
                    throw new Error(`Product with the name "${name}" already exists.`);
                }
            }

            // 3. Update the Product record
            const updatedProduct = await tx.product.update({
                where: { id },
                data: {
                    name,
                    category,
                    retailPrice: Number(retailPrice),
                    wholesalePrice: Number(wholesalePrice),
                    shelfLife: Number(shelfLife),
                    icon,
                    ...(req.body.dailyTarget !== undefined && { dailyTarget: Number(req.body.dailyTarget) || 100 })
                }
            });

            // 4. Wipe existing BOM recipe items
            await tx.recipeItem.deleteMany({ where: { productId: id } });

            // 5. Insert new BOM recipe items
            for (let code in bom) {
                const ingredient = await tx.ingredient.findUnique({ where: { code } });
                if (!ingredient) {
                    throw new Error(`Ingredient with code "${code}" not found in database.`);
                }
                
                await tx.recipeItem.create({
                    data: {
                        productId: id,
                        ingredientId: ingredient.id,
                        quantityGrams: Number(bom[code])
                    }
                });
            }

            // 6. Post system audit notification
            await tx.notification.create({
                data: {
                    type: 'info',
                    title: 'BOM Recipe Modified',
                    desc: `Product ${name} price and BOM card requirements updated in inventory database.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });

            return updatedProduct;
        });

        res.json({ success: true, product: result });
    } catch (e) {
        console.error('Product updates transaction failed, rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET: Retrieve all raw ingredients stock levels
app.get('/api/ingredients', async (req, res) => {
    try {
        const ingredients = await prisma.ingredient.findMany();
        res.json(ingredients);
    } catch (e) {
        res.status(500).json({ error: 'Failed to retrieve ingredients stock', details: e.message });
    }
});

// GET: Retrieve active FIFO batches (FR3)
app.get('/api/fifo', async (req, res) => {
    try {
        const activeFifo = await prisma.fifoBatch.findMany({
            where: { remainingQty: { gt: 0 } },
            include: { ingredient: true }
        });
        res.json(activeFifo);
    } catch (e) {
        res.status(500).json({ error: 'Failed to retrieve FIFO batches', details: e.message });
    }
});

/* ==========================================================================
   2. DAILY PRODUCTION & RECIPE BOM DEPLETION ENGINE (FR2 & FR3)
   ========================================================================== */

// GET: Retrieve completed production logs
app.get('/api/production', async (req, res) => {
    try {
        const logs = await prisma.productionLog.findMany({
            include: { product: true }
        });
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch production logs', details: e.message });
    }
});

// POST: Log Production Quota with atomic BOM and FIFO Perishable Depletions
app.post('/api/production', async (req, res) => {
    const { productId, quantity, simulatedDate } = req.body;
    const qty = Number(quantity);
    
    if (!productId || qty <= 0 || !simulatedDate) {
        return res.status(400).json({ error: 'Invalid production parameters supplied' });
    }

    try {
        // Execute whole BOM & FIFO depletion inside a database transaction to preserve ACID integrity!
        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch Product with its BOM Recipe mappings
            const product = await tx.product.findUnique({
                where: { id: productId },
                include: { recipes: { include: { ingredient: true } } }
            });
            if (!product) throw new Error('Product not found in database');

            // 2. Pre-verify sufficiency for all required ingredients in recipe.
            // For perishables, expired FIFO batch remainders are NOT usable stock —
            // they sit in central stock until discarded but must never be baked with.
            for (let recipe of product.recipes) {
                const totalNeeded = recipe.quantityGrams * qty;
                let usableStock = recipe.ingredient.stock;

                if (recipe.ingredient.isPerishable) {
                    const expiredBatches = await tx.fifoBatch.findMany({
                        where: {
                            ingredientId: recipe.ingredientId,
                            remainingQty: { gt: 0 },
                            expiryDate: { lt: simulatedDate }
                        }
                    });
                    const expiredQty = expiredBatches.reduce((sum, b) => sum + b.remainingQty, 0);
                    usableStock -= expiredQty;
                }

                if (usableStock < totalNeeded) {
                    throw new Error(`Insufficient Stock: Ingredient ${recipe.ingredient.name} has ${(Math.max(usableStock, 0)/1000).toFixed(1)}kg usable (non-expired) stock but this order requires ${(totalNeeded/1000).toFixed(1)}kg. Discard expired batches or replenish.`);
                }
            }

            // 3. Deplete materials from Central stock & FIFO Perishables batch queue
            for (let recipe of product.recipes) {
                const totalNeeded = recipe.quantityGrams * qty;

                // A. Deplete Central Stock balance
                await tx.ingredient.update({
                    where: { id: recipe.ingredientId },
                    data: { stock: { decrement: totalNeeded } }
                });

                // B. If perishable yeast/dairy, deplete from non-expired FIFO batches in first-in first-out date order
                if (recipe.ingredient.isPerishable) {
                    let qtyToDeplete = totalNeeded;

                    const activeBatches = await tx.fifoBatch.findMany({
                        where: {
                            ingredientId: recipe.ingredientId,
                            remainingQty: { gt: 0 },
                            expiryDate: { gte: simulatedDate } // never consume expired batches
                        }
                    });

                    // Sort oldest received batches first (FIFO)
                    activeBatches.sort((a, b) => new Date(a.dateReceived) - new Date(b.dateReceived));

                    for (let batch of activeBatches) {
                        if (qtyToDeplete <= 0) break;
                        
                        if (batch.remainingQty >= qtyToDeplete) {
                            await tx.fifoBatch.update({
                                where: { id: batch.id },
                                data: { remainingQty: { decrement: qtyToDeplete } }
                            });
                            qtyToDeplete = 0;
                        } else {
                            qtyToDeplete -= batch.remainingQty;
                            await tx.fifoBatch.update({
                                where: { id: batch.id },
                                data: { remainingQty: 0 }
                            });
                        }
                    }
                }
            }

            // 4. Calculate batch expiration date
            const prodDate = new Date(simulatedDate);
            const expDate = new Date(prodDate);
            expDate.setDate(expDate.getDate() + product.shelfLife);
            const expiryStr = expDate.toISOString().split('T')[0];

            // 5. Append Completed Production Batch record
            const nextBatchCode = `BCH-${Date.now().toString(36).toUpperCase()}`;
            
            const productionLog = await tx.productionLog.create({
                data: {
                    batchCode: nextBatchCode,
                    productId: productId,
                    quantity: qty,
                    dateProduced: simulatedDate,
                    expiryDate: expiryStr,
                    active: true
                },
                include: { product: true }
            });

            // 6. Post system notification
            await tx.notification.create({
                data: {
                    type: 'success',
                    title: 'Production Logged',
                    desc: `Batch ${nextBatchCode} for ${qty} pcs of ${product.name} logged. BOM ingredients depleted.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });

            return productionLog;
        });

        res.json({ success: true, productionLog: result });
    } catch (e) {
        console.error('Production transaction failed, rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

/* ==========================================================================
   3. POINT OF SALE (POS) & INVOICING API (FR1, FR2, FR4)
   ========================================================================== */

// GET: Fetch B2B invoices ledger
app.get('/api/invoices', async (req, res) => {
    try {
        const { simulatedDate } = req.query;
        if (simulatedDate) {
            // Find all Unpaid B2B invoices past their due dates and mark them Overdue
            await prisma.invoice.updateMany({
                where: {
                    status: 'Unpaid',
                    dueDate: { lt: simulatedDate }
                },
                data: {
                    status: 'Overdue'
                }
            });
        }
        
        const invoices = await prisma.invoice.findMany({
            include: { items: true, partner: true }
        });
        res.json(invoices);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch invoices', details: e.message });
    }
});

// POST: Execute atomic POS Checkout (depletes completed product batch FIFO stock & tracks B2B credit)
app.post('/api/checkout', async (req, res) => {
    const { customerType, partnerId, customerName, total, discount, tax, taxRate, grandTotal, paymentMethod, items, simulatedDate } = req.body;
    
    if (!customerType || grandTotal === undefined || !paymentMethod || !items || !items.length || !simulatedDate) {
        return res.status(400).json({ error: 'Missing core checkout parameters' });
    }

    // 4.10 Enum validations
    const ALLOWED_CUSTOMER_TYPES = ['B2C', 'B2B'];
    const ALLOWED_PAYMENT_METHODS = ['cash', 'card', 'credit'];
    if (!ALLOWED_CUSTOMER_TYPES.includes(customerType)) {
        return res.status(400).json({ error: `Invalid customerType. Must be one of: ${ALLOWED_CUSTOMER_TYPES.join(', ')}` });
    }
    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
        return res.status(400).json({ error: `Invalid paymentMethod. Must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}` });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            
            // Server-side price recalculation — never trust client-supplied totals
            const allProducts = await tx.product.findMany();
            let serverTotal = 0;
            let serverGrandTotal = 0;
            for (const cartItem of items) {
                const dbProduct = allProducts.find(p => p.name === cartItem.name);
                if (!dbProduct) throw new Error(`Product "${cartItem.name}" not found in database`);
                serverTotal += dbProduct.retailPrice * Number(cartItem.qty);
                const unitPrice = customerType === 'B2B' ? dbProduct.wholesalePrice : dbProduct.retailPrice;
                serverGrandTotal += unitPrice * Number(cartItem.qty);
            }
            const serverDiscount = serverTotal - serverGrandTotal;

            // Recalculate Tax VAT
            const serverTaxRate = Number(taxRate || 0);
            const serverTaxAmount = serverGrandTotal * (serverTaxRate / 100);
            serverGrandTotal = serverGrandTotal + serverTaxAmount;

            let outstanding = 0.0;
            let invoiceStatus = 'Paid';
            let dueDate = simulatedDate;

            // A. If B2B Credit sale, perform credit limit verification
            if (customerType === 'B2B' && paymentMethod === 'credit') {
                if (!partnerId) throw new Error('Corporate Partner ID is required for B2B credit checkout');
                
                const partner = await tx.b2bPartner.findUnique({ where: { id: partnerId } });
                if (!partner) throw new Error('B2B wholesale Partner not found');
                
                // Credit Ceiling limit check
                const availableCredit = partner.limit - partner.balance;
                if (serverGrandTotal > availableCredit) {
                    throw new Error(`Credit Limit Breached: Outstandings limit LKR ${partner.limit.toLocaleString()} breached! Available credit line is only LKR ${availableCredit.toLocaleString()}.`);
                }

                outstanding = serverGrandTotal;
                invoiceStatus = 'Unpaid';
                
                const due = new Date(simulatedDate);
                due.setDate(due.getDate() + partner.terms);
                dueDate = due.toISOString().split('T')[0];

                // Accumulate B2B partner's credit outstanding balance
                await tx.b2bPartner.update({
                    where: { id: partnerId },
                    data: { balance: { increment: serverGrandTotal } }
                });
            }

            // B. Deduct purchased product quantity from completed active production batches (FIFO).
            // Expired batches are excluded — day-old expired goods must never be sold.
            for (let cartItem of items) {
                let qtyToDeplete = cartItem.qty;

                // Find completed active non-expired batches for this product in SQL db
                const productBatches = await tx.productionLog.findMany({
                    where: { active: true, expiryDate: { gte: simulatedDate } },
                    include: { product: true }
                });

                // Filter matching product name and sort oldest produced first (FIFO)
                const matchingBatches = productBatches
                    .filter(b => b.product.name === cartItem.name)
                    .sort((a, b) => new Date(a.dateProduced) - new Date(b.dateProduced));

                let totalAvailableProductStock = matchingBatches.reduce((sum, b) => sum + b.quantity, 0);
                if (totalAvailableProductStock < qtyToDeplete) {
                    throw new Error(`Insufficient Batch Stock: Product ${cartItem.name} only has ${totalAvailableProductStock} fresh (non-expired) pieces left in completed batches, but cart checkout requires ${qtyToDeplete} units.`);
                }

                for (let batch of matchingBatches) {
                    if (qtyToDeplete <= 0) break;
                    
                    if (batch.quantity >= qtyToDeplete) {
                        await tx.productionLog.update({
                            where: { id: batch.id },
                            data: {
                                quantity: { decrement: qtyToDeplete },
                                active: batch.quantity === qtyToDeplete ? false : true
                            }
                        });
                        qtyToDeplete = 0;
                    } else {
                        qtyToDeplete -= batch.quantity;
                        await tx.productionLog.update({
                            where: { id: batch.id },
                            data: { quantity: 0, active: false }
                        });
                    }
                }
            }

            // C. Write Invoice Record with a human-friendly sequential number.
            // The unique constraint on invoiceNo makes concurrent collisions roll
            // back the whole transaction; the client simply retries the checkout.
            const year = new Date(simulatedDate).getFullYear();
            const seq = await tx.invoice.count({ where: { customerType } });
            const invoiceNo = customerType === 'B2B'
                ? `INV-${year}-${String(seq + 1).padStart(4, '0')}`
                : `B2C-TXN-${1001 + seq}`;
                
            const dbInvoice = await tx.invoice.create({
                data: {
                    invoiceNo: invoiceNo,
                    customerType: customerType,
                    partnerId: customerType === 'B2B' ? partnerId : null,
                    customerName: customerName,
                    date: simulatedDate,
                    dueDate: dueDate,
                    total: serverTotal,
                    discount: serverDiscount,
                    tax: serverTaxAmount,
                    taxRate: serverTaxRate,
                    grandTotal: serverGrandTotal,
                    method: paymentMethod,
                    outstanding: outstanding,
                    paidAmount: paymentMethod === 'credit' ? 0.0 : serverGrandTotal,
                    status: invoiceStatus
                }
            });

            // D. Populate Invoice Line Items
            for (let cartItem of items) {
                await tx.invoiceItem.create({
                    data: {
                        invoiceId: dbInvoice.id,
                        productName: cartItem.name,
                        quantity: Number(cartItem.qty),
                        retailPrice: Number(cartItem.retailPrice),
                        wholesalePrice: Number(cartItem.wholesalePrice)
                    }
                });
            }

            // E. Post transactional cashbook ledger post
            await tx.financialLog.create({
                data: {
                    txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    date: simulatedDate,
                    description: customerType === 'B2B' ? `B2B Invoice Billing ${invoiceNo} (Method: ${paymentMethod.toUpperCase()})` : `B2C POS Sale ${invoiceNo} (Cash/Card)`,
                    method: paymentMethod,
                    amount: serverGrandTotal
                }
            });

            // F. Add system notification
            await tx.notification.create({
                data: {
                    type: 'success',
                    title: 'POS Checkout Complete',
                    desc: `Sale ${invoiceNo} logged. net LKR ${serverGrandTotal.toFixed(2)} posted to ledger.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });

            return { invoice: dbInvoice, invoiceNo };
        });

        res.json({ success: true, result });
    } catch (e) {
        console.error('POS Checkout failed, transaction rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

// POST: Refund a paid invoice, option to restore raw materials stock
app.post('/api/invoices/:id/refund', async (req, res) => {
    try {
        const { id } = req.params;
        const { spoiled } = req.body; // true = do not restore stock, false = restore ingredients
        
        const result = await prisma.$transaction(async (tx) => {
            // Find invoice. We can query by id or invoiceNo since users click both
            const invoice = await tx.invoice.findFirst({
                where: {
                    OR: [
                        { id: id },
                        { invoiceNo: id }
                    ]
                },
                include: { items: true }
            });
            
            if (!invoice) throw new Error('Invoice not found');
            if (invoice.status === 'Refunded') throw new Error('Invoice already fully refunded');
            
            // 1. If not spoiled, calculate and restore ingredients stock
            if (!spoiled) {
                // Loop through invoice items
                for (const item of invoice.items) {
                    // Find product recipe
                    const product = await tx.product.findUnique({
                        where: { name: item.productName },
                        include: { recipes: { include: { ingredient: true } } }
                    });
                    
                    if (product && product.recipes) {
                        for (const recipeItem of product.recipes) {
                            const totalQtyToRestore = recipeItem.quantityGrams * item.quantity;
                            
                            // Restore central stock
                            await tx.ingredient.update({
                                where: { id: recipeItem.ingredientId },
                                data: { stock: { increment: totalQtyToRestore } }
                            });
                        }
                    }
                }
            }
            
            // 2. Adjust B2B outstanding if credit B2B invoice was refunded
            if (invoice.customerType === 'B2B' && invoice.partnerId) {
                // Reduce the outstanding credit and B2bPartner balance
                await tx.b2bPartner.update({
                    where: { id: invoice.partnerId },
                    data: { balance: { decrement: invoice.outstanding } }
                });
            }
            
            // 3. Mark invoice as Refunded
            const updatedInvoice = await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                    status: 'Refunded',
                    outstanding: 0.0
                }
            });
            
            // 4. Post transactional cashbook reverse ledger post
            await tx.financialLog.create({
                data: {
                    txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    date: invoice.date,
                    description: `Invoice Refund reversed: ${invoice.invoiceNo} (${spoiled ? 'Spoiled/Wastage' : 'Returned Stock Restored'})`,
                    method: invoice.method,
                    amount: -invoice.grandTotal
                }
            });
            
            // 5. Add notification
            await tx.notification.create({
                data: {
                    type: 'info',
                    title: 'Invoice Refunded',
                    desc: `Invoice ${invoice.invoiceNo} successfully refunded.`,
                    time: new Date().toISOString(),
                    isAudit: true
                }
            });
            
            return updatedInvoice;
        });
        
        res.json({ success: true, invoice: result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to refund invoice', details: e.message });
    }
});

// POST: Void an unpaid B2B Credit invoice to release credit hold
app.post('/api/invoices/:id/void', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await prisma.$transaction(async (tx) => {
            const invoice = await tx.invoice.findFirst({
                where: {
                    OR: [
                        { id: id },
                        { invoiceNo: id }
                    ]
                }
            });
            if (!invoice) throw new Error('Invoice not found');
            if (invoice.status !== 'Unpaid' && invoice.status !== 'Overdue') {
                throw new Error('Only unpaid or overdue B2B credit invoices can be voided');
            }
            
            // 1. Release B2B Credit limit outstanding
            if (invoice.customerType === 'B2B' && invoice.partnerId) {
                const partner = await tx.b2bPartner.findUnique({ where: { id: invoice.partnerId } });
                if (partner) {
                    let newBalance = partner.balance - invoice.grandTotal;
                    if (newBalance < 0) newBalance = 0;
                    await tx.b2bPartner.update({
                        where: { id: invoice.partnerId },
                        data: { balance: newBalance }
                    });
                }
            }
            
            // 2. Mark invoice as Voided
            const updatedInvoice = await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                    status: 'Voided',
                    outstanding: 0.0
                }
            });
            
            // 3. Post transactional cashbook reverse ledger post
            await tx.financialLog.create({
                data: {
                    txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    date: invoice.date,
                    description: `Invoice Voided: ${invoice.invoiceNo} (Credit Released)`,
                    method: invoice.method,
                    amount: -invoice.grandTotal
                }
            });
            
            // 4. Add notification
            await tx.notification.create({
                data: {
                    type: 'warning',
                    title: 'Invoice Voided',
                    desc: `Invoice ${invoice.invoiceNo} successfully voided.`,
                    time: new Date().toISOString(),
                    isAudit: true
                }
            });
            
            return updatedInvoice;
        });
        
        res.json({ success: true, invoice: result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to void invoice', details: e.message });
    }
});

/* ==========================================================================
   4. B2B WHOLESALE & ACCOUNTS RECEIVABLE PAYMENT CAPTURE (FR4)
   ========================================================================== */

// GET: Fetch B2B wholesale partner details
app.get('/api/partners', async (req, res) => {
    try {
        const partners = await prisma.b2bPartner.findMany();
        res.json(partners);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch B2B partners directory', details: e.message });
    }
});

// POST: Add new B2B Partner
app.post('/api/partners', async (req, res) => {
    const { name, address, terms, limit } = req.body;
    if (!name || !address || limit === undefined) {
        return res.status(400).json({ error: 'Missing core B2B registration details' });
    }
    try {
        const partner = await prisma.b2bPartner.create({
            data: {
                name,
                address,
                terms: Number(terms) || 30,
                limit: Number(limit)
            }
        });
        
        await prisma.notification.create({
            data: {
                type: 'success',
                title: 'B2B Partner Registered',
                desc: `Wholesale client ${name} added with a LKR ${limit.toLocaleString()} credit line.`,
                time: 'Just Now',
                isAudit: false
            }
        });
        
        res.json({ success: true, partner });
    } catch (e) {
        res.status(500).json({ error: 'Registration failed', details: e.message });
    }
});

// POST: Capture payment against B2B Credit Outstanding invoice
app.post('/api/payments', async (req, res) => {
    const { partnerId, invoiceId, payAmount, simulatedDate } = req.body;
    const amount = Number(payAmount);
    
    if (!partnerId || !invoiceId || amount <= 0 || !simulatedDate) {
        return res.status(400).json({ error: 'Missing core payment attributes' });
    }

    try {
        await prisma.$transaction(async (tx) => {
            const partner = await tx.b2bPartner.findUnique({ where: { id: partnerId } });
            const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
            
            if (!partner || !invoice) throw new Error('B2B Partner or Invoice records not found');
            if (amount > invoice.outstanding) {
                throw new Error(`Overpayment error: Payment LKR ${amount} exceeds invoice outstanding balance LKR ${invoice.outstanding}.`);
            }

            // 1. Reduce invoice outstanding balance
            const newOutstanding = invoice.outstanding - amount;
            const newPaid = invoice.paidAmount + amount;
            const newStatus = newOutstanding === 0 ? 'Paid' : 'Partially Paid';
            
            await tx.invoice.update({
                where: { id: invoiceId },
                data: {
                    outstanding: newOutstanding,
                    paidAmount: newPaid,
                    status: newStatus
                }
            });

            // 2. Reduce Partner's total outstanding balance
            await tx.b2bPartner.update({
                where: { id: partnerId },
                data: { balance: { decrement: amount } }
            });

            // 3. Post transaction ledger entry
            await tx.financialLog.create({
                data: {
                    txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    date: simulatedDate,
                    description: `B2B Credit Receipt Capture from ${partner.name} against invoice ${invoice.invoiceNo}`,
                    method: 'payment-in',
                    amount: amount
                }
            });

            // 4. Add system notification
            await tx.notification.create({
                data: {
                    type: 'success',
                    title: 'Credit Payment Received',
                    desc: `Captured LKR ${amount.toLocaleString()} payment from ${partner.name} against ${invoice.invoiceNo}.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });
        });

        res.json({ success: true });
    } catch (e) {
        console.error('Credit payment posting failed, transaction rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

/* ==========================================================================
   5. STOCK INTAKE REPLENISHMENT API (FR3)
   ========================================================================== */

// POST: Replenish raw ingredient stock and create FIFO batch
app.post('/api/replenish', async (req, res) => {
    const { ingredientCode, quantity, receivingDate } = req.body;
    const qty = Number(quantity);
    
    if (!ingredientCode || qty <= 0 || !receivingDate) {
        return res.status(400).json({ error: 'Missing replenishment arguments' });
    }

    try {
        await prisma.$transaction(async (tx) => {
            const ingredient = await tx.ingredient.findUnique({ where: { code: ingredientCode } });
            if (!ingredient) throw new Error('Ingredient not found');
            
            const quantityInGrams = ingredient.unit === 'g' ? qty * 1000 : qty;
            
            // A. Update central stock levels
            await tx.ingredient.update({
                where: { code: ingredientCode },
                data: { stock: { increment: quantityInGrams } }
            });
            
            // B. If perishable yeast/dairy, generate a new FIFO batch record
            if (ingredient.isPerishable) {
                // Shelf life: 7 days
                const exp = new Date(receivingDate);
                exp.setDate(exp.getDate() + 7);
                const expiryDateStr = exp.toISOString().split('T')[0];
                
                const nextBatchCode = `FIFO-${Date.now().toString(36).toUpperCase()}`;
                
                await tx.fifoBatch.create({
                    data: {
                        batchCode: nextBatchCode,
                        ingredientId: ingredient.id,
                        dateReceived: receivingDate,
                        originalQty: quantityInGrams,
                        remainingQty: quantityInGrams,
                        expiryDate: expiryDateStr
                    }
                });
                
                await tx.notification.create({
                    data: {
                        type: 'success',
                        title: 'FIFO Batch Received',
                        desc: `Perishable ${ingredient.name} batch ${nextBatchCode} received on ${receivingDate}. Expiry ${expiryDateStr}.`,
                        time: new Date().toISOString(),
                        isAudit: false
                    }
                });
            } else {
                await tx.notification.create({
                    data: {
                        type: 'success',
                        title: 'Stock Replenished',
                        desc: `Central stock for ${ingredient.name} increased by ${qty} ${ingredient.unit === 'g' ? 'kg' : ingredient.unit}.`,
                        time: new Date().toISOString(),
                        isAudit: false
                    }
                });
            }

            // Post transaction timeline log
            await tx.financialLog.create({
                data: {
                    txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                    date: receivingDate,
                    description: `Inventory Replenishment of ${ingredient.name} (+${qty} ${ingredient.unit === 'g' ? 'kg' : ingredient.unit})`,
                    method: 'cash',
                    amount: 0.0
                }
            });
        });
        
        res.json({ success: true });
    } catch (e) {
        console.error('Replenishment failed, transaction rolled back:', e);
        res.status(500).json({ error: e.message });
    }
});

/* ==========================================================================
   5b. ADDITIONAL CRUD ENDPOINTS
   ========================================================================== */

// DELETE: Remove a product by ID
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const product = await prisma.product.findUnique({ where: { id } });
        if (!product) return res.status(404).json({ error: 'Product not found' });
        
        const usedInLogs = await prisma.productionLog.findFirst({ where: { productId: id } });
        if (usedInLogs) {
            return res.status(409).json({ error: `Cannot delete '${product.name}' — it has production history.` });
        }
        
        await prisma.product.delete({ where: { id } });
        res.json({ success: true, message: `Product '${product.name}' deleted.` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete product', details: e.message });
    }
});

// PUT: Update a B2B partner profile
app.put('/api/partners/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, address, terms, limit } = req.body;
        
        const partner = await prisma.b2bPartner.findUnique({ where: { id } });
        if (!partner) return res.status(404).json({ error: 'Partner not found' });
        
        const updated = await prisma.b2bPartner.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(address !== undefined && { address }),
                ...(terms !== undefined && { terms: Number(terms) }),
                ...(limit !== undefined && { limit: Number(limit) })
            }
        });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update partner', details: e.message });
    }
});

// DELETE: Remove a B2B partner (only if no outstanding balance)
app.delete('/api/partners/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const partner = await prisma.b2bPartner.findUnique({ where: { id } });
        if (!partner) return res.status(404).json({ error: 'Partner not found' });
        
        if (partner.balance > 0) {
            return res.status(409).json({ error: `Cannot delete partner with outstanding balance of LKR ${partner.balance}` });
        }
        
        await prisma.b2bPartner.delete({ where: { id } });
        res.json({ success: true, message: `Partner '${partner.name}' deleted.` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete partner', details: e.message });
    }
});

// POST: Add a new ingredient type
app.post('/api/ingredients', async (req, res) => {
    try {
        const { code, name, stock, unit, threshold, unitCost, isPerishable } = req.body;

        const existing = await prisma.ingredient.findUnique({ where: { code } });
        if (existing) return res.status(409).json({ error: `Ingredient code '${code}' already exists` });

        const ingredient = await prisma.ingredient.create({
            data: {
                code,
                name,
                stock: Number(stock) || 0,
                unit: unit || 'g',
                threshold: Number(threshold) || 0,
                unitCost: Number(unitCost) || 0,
                isPerishable: Boolean(isPerishable)
            }
        });
        res.json(ingredient);
    } catch (e) {
        res.status(500).json({ error: 'Failed to create ingredient', details: e.message });
    }
});

// PUT: Update an ingredient's properties
app.put('/api/ingredients/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const { name, threshold, unit, unitCost, isPerishable } = req.body;

        const ingredient = await prisma.ingredient.findUnique({ where: { code } });
        if (!ingredient) return res.status(404).json({ error: 'Ingredient not found' });

        const updated = await prisma.ingredient.update({
            where: { code },
            data: {
                ...(name !== undefined && { name }),
                ...(threshold !== undefined && { threshold: Number(threshold) }),
                ...(unit !== undefined && { unit }),
                ...(unitCost !== undefined && { unitCost: Number(unitCost) }),
                ...(isPerishable !== undefined && { isPerishable: Boolean(isPerishable) })
            }
        });
        res.json(updated);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update ingredient', details: e.message });
    }
});

// DELETE: Remove an ingredient by code
app.delete('/api/ingredients/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const ingredient = await prisma.ingredient.findUnique({ where: { code } });
        if (!ingredient) return res.status(404).json({ error: 'Ingredient not found' });
        
        // Check if ingredient is used in any recipe BOMs
        const usedInRecipe = await prisma.recipeItem.findFirst({ where: { ingredientId: ingredient.id } });
        if (usedInRecipe) {
            return res.status(409).json({ error: `Cannot delete '${ingredient.name}' — it is used in active product recipes.` });
        }
        
        // Check if there are active batches in FIFO queue
        const activeBatches = await prisma.fifoBatch.findFirst({
            where: { ingredientId: ingredient.id, remainingQty: { gt: 0 } }
        });
        if (activeBatches) {
            return res.status(409).json({ error: `Cannot delete '${ingredient.name}' — it has active perishable batches in stock.` });
        }
        
        // Delete all depleted/empty batches for this ingredient first
        await prisma.fifoBatch.deleteMany({ where: { ingredientId: ingredient.id } });
        
        // Delete the ingredient
        await prisma.ingredient.delete({ where: { id: ingredient.id } });
        res.json({ success: true, message: `Ingredient '${ingredient.name}' deleted.` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete ingredient', details: e.message });
    }
});

// POST: Adjust stock level manually for raw material
app.post('/api/ingredients/:code/adjust', async (req, res) => {
    try {
        const { code } = req.params;
        const { type, quantity, notes } = req.body; // quantity can be positive or negative
        
        // 4.10 Enum validations
        const ALLOWED_ADJ_TYPES = ['spoilage', 'discrepancy', 'audit'];
        if (!ALLOWED_ADJ_TYPES.includes(type)) {
            return res.status(400).json({ error: `Invalid adjustment type. Must be one of: ${ALLOWED_ADJ_TYPES.join(', ')}` });
        }
        
        const result = await prisma.$transaction(async (tx) => {
            const ingredient = await tx.ingredient.findUnique({ where: { code } });
            if (!ingredient) throw new Error('Ingredient not found');
            
            const newStock = ingredient.stock + Number(quantity);
            if (newStock < 0) throw new Error('Deduction exceeds available stock');
            
            // 1. Update ingredient stock level
            const updated = await tx.ingredient.update({
                where: { code },
                data: { stock: newStock }
            });
            
            // 2. If deduction, log financial transaction write-off priced at the
            // ingredient's configured unit cost (per kg for 'g' units, per piece otherwise)
            if (Number(quantity) < 0) {
                const absoluteQty = Math.abs(Number(quantity)) / (ingredient.unit === 'g' ? 1000 : 1);
                const lossAmount = absoluteQty * (ingredient.unitCost || 0);
                
                await tx.financialLog.create({
                    data: {
                        txnCode: `TXN-${Date.now().toString(36).toUpperCase()}`,
                        date: new Date().toISOString().split('T')[0],
                        description: `Wastage Write-Off: ${type.toUpperCase()} - ${ingredient.name} (${absoluteQty.toFixed(1)}${ingredient.unit === 'g' ? 'kg' : ingredient.unit}) - Notes: ${notes}`,
                        method: 'cash',
                        amount: -lossAmount
                    }
                });
            }
            
            // 3. Create a warning/info notification
            await tx.notification.create({
                data: {
                    type: Number(quantity) < 0 ? 'warning' : 'success',
                    title: 'Manual Stock Adjustment',
                    desc: `${ingredient.name} stock manually adjusted by ${Number(quantity) > 0 ? '+' : ''}${(Number(quantity)/(ingredient.unit === 'g' ? 1000 : 1)).toFixed(1)}${ingredient.unit === 'g' ? 'kg' : ingredient.unit}. Reason: ${notes}`,
                    time: new Date().toISOString(),
                    isAudit: true
                }
            });
            
            return updated;
        });
        
        res.json({ success: true, ingredient: result });
    } catch (e) {
        res.status(500).json({ error: 'Failed to adjust stock', details: e.message });
    }
});

// POST: Discard/write-off a FIFO batch
app.post('/api/fifo/:id/discard', async (req, res) => {
    try {
        const { id } = req.params;
        const batch = await prisma.fifoBatch.findUnique({ where: { id } });
        if (!batch) return res.status(404).json({ error: 'FIFO batch not found' });
        
        if (batch.remainingQty <= 0) {
            return res.status(400).json({ error: 'Batch already fully depleted' });
        }
        
        const discardedQty = batch.remainingQty;
        
        await prisma.$transaction(async (tx) => {
            await tx.fifoBatch.update({
                where: { id },
                data: { remainingQty: 0 }
            });
            await tx.ingredient.update({
                where: { id: batch.ingredientId },
                data: { stock: { decrement: discardedQty } }
            });
            await tx.notification.create({
                data: {
                    type: 'warning',
                    title: 'FIFO Batch Discarded',
                    desc: `Batch ${batch.batchCode} (${(discardedQty/1000).toFixed(1)}kg) written off.`,
                    time: new Date().toISOString(),
                    isAudit: false
                }
            });
        });
        
        res.json({ success: true, discardedQty, message: `Batch discarded. ${(discardedQty/1000).toFixed(1)}kg removed from central stock.` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to discard batch', details: e.message });
    }
});

/* ==========================================================================
   5c. MULTI-STAFF AUTHENTICATION & ACCESS REGISTRY API
   ========================================================================== */

// POST: Authenticate user login — verifies scrypt hash, issues a bearer token
app.post('/api/login', async (req, res) => {
    try {
        const { username, passkey } = req.body;
        if (!username || !passkey) {
            return res.status(400).json({ error: 'Username and Access Key are required' });
        }

        const staff = await prisma.staff.findUnique({
            where: { username: username.toLowerCase().trim() }
        });

        if (!staff) {
            return res.status(401).json({ error: 'Incorrect username or system access key' });
        }

        const check = verifyPasskey(passkey, staff.passkey);
        if (!check.ok) {
            return res.status(401).json({ error: 'Incorrect username or system access key' });
        }

        // Transparently upgrade legacy plaintext passkeys to scrypt hashes
        if (check.legacy) {
            await prisma.staff.update({
                where: { id: staff.id },
                data: { passkey: hashPasskey(passkey) }
            });
        }

        const token = randomUUID() + randomBytes(16).toString('hex');
        sessions.set(token, {
            staffId: staff.id,
            username: staff.username,
            role: staff.role,
            expiresAt: Date.now() + SESSION_TTL_MS
        });

        res.json({
            success: true,
            token: token,
            user: {
                username: staff.username,
                name: staff.name,
                role: staff.role
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Authentication engine failed', details: e.message });
    }
});

// GET: Fetch list of all registered staff accounts (Admin Only) — passkeys never leave the server
app.get('/api/staff', async (req, res) => {
    try {
        const staffList = await prisma.staff.findMany();
        res.json(staffList.map(sanitizeStaff));
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch staff registry', details: e.message });
    }
});

// POST: Register a new staff account (Admin Only)
app.post('/api/staff', async (req, res) => {
    try {
        const { username, name, role, passkey } = req.body;
        if (!username || !name || !role || !passkey) {
            return res.status(400).json({ error: 'All fields are required to register staff' });
        }
        
        const normalizedUsername = username.toLowerCase().trim();
        const existing = await prisma.staff.findUnique({
            where: { username: normalizedUsername }
        });
        
        if (existing) {
            return res.status(409).json({ error: `Username '${normalizedUsername}' is already registered` });
        }
        
        const newStaff = await prisma.staff.create({
            data: {
                username: normalizedUsername,
                name,
                role,
                passkey: hashPasskey(passkey)
            }
        });
        res.json(sanitizeStaff(newStaff));
    } catch (e) {
        res.status(500).json({ error: 'Failed to register staff account', details: e.message });
    }
});

// PUT: Edit staff member properties (Admin Only)
app.put('/api/staff/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, passkey } = req.body;
        
        const staff = await prisma.staff.findUnique({ where: { id } });
        if (!staff) return res.status(404).json({ error: 'Staff account not found' });
        
        const updated = await prisma.staff.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(role !== undefined && { role }),
                ...(passkey !== undefined && passkey !== '' && { passkey: hashPasskey(passkey) })
            }
        });
        res.json(sanitizeStaff(updated));
    } catch (e) {
        res.status(500).json({ error: 'Failed to update staff account', details: e.message });
    }
});

// DELETE: Delete a staff member (Admin Only)
app.delete('/api/staff/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const staff = await prisma.staff.findUnique({ where: { id } });
        if (!staff) return res.status(404).json({ error: 'Staff account not found' });
        
        // Prevent deleting active admin accounts to avoid self-lockout
        if (staff.username === 'anura') {
            return res.status(409).json({ error: 'Cannot delete default primary owner/admin account' });
        }
        
        await prisma.staff.delete({ where: { id } });
        res.json({ success: true, message: `Staff account '${staff.name}' deleted successfully` });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete staff account', details: e.message });
    }
});

/* ==========================================================================
   6. REPORTING DASHBOARD ANALYTICS API & CLOCK AUDITING (FR4)
   ========================================================================== */

// GET: Fetch dashboard visual KPIs & SVG graph coordinate metrics
app.get('/api/dashboard', async (req, res) => {
    const { simulatedDate } = req.query;
    if (!simulatedDate) {
        return res.status(400).json({ error: 'Missing simulation date query' });
    }
    
    try {
        const simDate = new Date(simulatedDate);

        // 1. Total sales revenue
        const invoices = await prisma.invoice.findMany({ include: { items: true } });
        const totalSalesSum = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);

        // 2. Outstanding Receivables
        const totalReceivables = invoices
            .filter(inv => inv.customerType === 'B2B')
            .reduce((sum, inv) => sum + inv.outstanding, 0);

        // 3. Low stock count
        const ingredients = await prisma.ingredient.findMany();
        const lowStockCount = ingredients.filter(ing => ing.stock <= ing.threshold).length;

        // 4. Daily Production Log output matching simulated date
        const productionLogs = await prisma.productionLog.findMany({ include: { product: true } });
        const dailyProductionOutput = productionLogs
            .filter(log => log.dateProduced === simulatedDate)
            .reduce((sum, log) => sum + log.quantity, 0);

        // 5. Build chronological sales chart details (B2C cash vs B2B wholesale credit)
        const salesByDate = {};
        invoices.forEach(inv => {
            const d = inv.date;
            if (!salesByDate[d]) {
                salesByDate[d] = { b2c: 0, b2b: 0 };
            }
            if (inv.customerType === 'B2B') {
                salesByDate[d].b2b += inv.grandTotal;
            } else {
                salesByDate[d].b2c += inv.grandTotal;
            }
        });
        const chartDates = Object.keys(salesByDate).sort((a,b) => new Date(a) - new Date(b));
        const chartDataPoints = chartDates.map(d => ({
            date: d,
            b2c: salesByDate[d].b2c,
            b2b: salesByDate[d].b2b
        }));

        // 6. Visual Daily Production Quotas (target configured per product)
        const products = await prisma.product.findMany();
        const productionQuotas = products.map(prod => {
            const target = prod.dailyTarget || 100;
            const todayLogged = productionLogs
                .filter(log => log.product.name === prod.name && log.dateProduced === simulatedDate)
                .reduce((sum, log) => sum + log.quantity, 0);
            return {
                name: prod.name,
                logged: todayLogged,
                target: target,
                pct: Math.min((todayLogged / target) * 100, 100)
            };
        });

        // 7. Recent Cashbook ledger transaction timeline lists (limit to 6)
        const txns = await prisma.financialLog.findMany();
        const recentTimeline = txns
            .sort((a,b) => new Date(b.date) - new Date(a.date))
            .slice(0, 6);

        res.json({
            kpis: {
                totalSales: totalSalesSum,
                receivables: totalReceivables,
                lowStockCount,
                dailyProduction: dailyProductionOutput
            },
            chart: chartDataPoints,
            quotas: productionQuotas,
            timeline: recentTimeline
        });

    } catch (e) {
        res.status(500).json({ error: 'Failed to compile dashboard metrics', details: e.message });
    }
});

/* ==========================================================================
   6b. FINANCIAL CASHBOOK LEDGER & GLOBAL CONFIG API
   ========================================================================== */

// GET: Full cashbook ledger — includes payments-in, refunds, and write-offs
// that are not derivable from invoices alone
app.get('/api/financial-log', async (req, res) => {
    try {
        const txns = await prisma.financialLog.findMany();
        res.json(txns);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch financial ledger', details: e.message });
    }
});

// GET: Global configuration singleton (created on first read if missing)
app.get('/api/config', async (req, res) => {
    try {
        let config = await prisma.globalConfig.findUnique({ where: { id: 'global' } });
        if (!config) {
            config = await prisma.globalConfig.create({ data: { id: 'global' } });
        }
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch global configuration', details: e.message });
    }
});

// PUT: Update global configuration (Admin only — enforced by auth middleware)
app.put('/api/config', async (req, res) => {
    try {
        const { defaultVAT, defaultCreditLimit, autoPrintReceipt, bakeryName, bakeryAddress, bakeryPhone } = req.body;
        const config = await prisma.globalConfig.upsert({
            where: { id: 'global' },
            create: { id: 'global' },
            update: {
                ...(defaultVAT !== undefined && { defaultVAT: Number(defaultVAT) }),
                ...(defaultCreditLimit !== undefined && { defaultCreditLimit: Number(defaultCreditLimit) }),
                ...(autoPrintReceipt !== undefined && { autoPrintReceipt: Boolean(autoPrintReceipt) }),
                ...(bakeryName !== undefined && { bakeryName }),
                ...(bakeryAddress !== undefined && { bakeryAddress }),
                ...(bakeryPhone !== undefined && { bakeryPhone })
            }
        });
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: 'Failed to update global configuration', details: e.message });
    }
});

/* ==========================================================================
   7. NOTIFICATIONS LEDGER API
   ========================================================================== */

// GET: Retrieve notifications list
app.get('/api/notifications', async (req, res) => {
    try {
        const list = await prisma.notification.findMany();
        // Sort newest first
        list.reverse();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch notifications', details: e.message });
    }
});

// POST: Clear notifications
app.post('/api/notifications/clear', async (req, res) => {
    try {
        await prisma.notification.deleteMany();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to clear notifications', details: e.message });
    }
});

/* ==========================================================================
   GLOBAL ERROR HANDLER
   ========================================================================== */
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

/* ==========================================================================
   SERVER INITIALIZATION
   ========================================================================== */
app.listen(PORT, () => {
    console.log(`Blissburn ERP Production REST Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received. Shutting down gracefully...');
    await prisma.$disconnect();
    process.exit(0);
});
