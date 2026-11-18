// Loads a realistic RevenueOS demo story into the DEMO copy of the app, through the
// API, signed in as the four test users, so every record goes through the real
// business rules and has its real history.
//
// NEVER point it at the live backend: it refuses unless the API answers on the demo
// port (3002) or DEMO_SEED_ALLOW_PORT names the port on purpose.
//
//   DEMO_PASSWORD=... node deploy/demo/seed-demo-data.mjs     (normally via load-demo-data.sh)
//
// The story (companies, people and GSTINs are fictional):
//   Patil Agro, Joshi Textiles  new enquiries, not yet assigned  (Sales Manager assigns)
//   Deshmukh Foods              with Pre-Sales, call booked for tomorrow
//   Kulkarni Chemicals          with Pre-Sales, call done, ready to qualify
//   Rao Engineering             rejected by Pre-Sales (no budget)
//   Shah Pharma                 with Sales: deal at Proposal, quotation in DRAFT
//   Nair Steel Works            order placed, advance paid, waiting for Finance to verify
//   Mehta Plastics              advance verified, waiting for Finance commercial approval
//   Gupta Packaging             fully approved, ready for dispatch (deal WON)

const API = process.env.API || 'http://127.0.0.1:3002';
const PASSWORD = process.env.DEMO_PASSWORD;
const DOMAIN = process.env.TEST_USER_DOMAIN || 'texzium.test';
const port = new URL(API).port;
if (port !== '3002' && port !== process.env.DEMO_SEED_ALLOW_PORT) {
  console.error(
    `Refusing: ${API} is not the demo backend (port 3002). This script only loads demo data.`,
  );
  process.exit(1);
}
if (!PASSWORD) {
  console.error('DEMO_PASSWORD (the test users’ password) is not set.');
  process.exit(1);
}

const today = new Date();
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = Array.isArray(data?.message)
      ? data.message.join('; ')
      : (data?.message ?? text);
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return data;
}

async function login(local) {
  const { access_token } = await call(null, 'POST', '/auth/login', {
    email: `${local}@${DOMAIN}`,
    password: PASSWORD,
  });
  const payload = JSON.parse(
    Buffer.from(access_token.split('.')[1], 'base64url').toString(),
  );
  return { token: access_token, id: payload.sub, name: local };
}

const step = (msg) => console.log(`  - ${msg}`);

async function main() {
  console.log(`Loading demo data into ${API}`);
  const pre = await login('presales');
  const sales = await login('sales');
  const mgr = await login('salesmanager');
  const fin = await login('finance');

  // Already loaded? (the Sales Manager sees every lead)
  const existing = await call(mgr.token, 'GET', '/leads');
  const rows = Array.isArray(existing) ? existing : (existing?.data ?? []);
  if (rows.some((l) => l.companyName === 'Shah Pharma')) {
    console.log('Demo data is already loaded; nothing changed.');
    return;
  }

  // Masters that already exist in the copy of live: a lead source, a product with
  // an HSN code, and the company's GST registration.
  let sources = await call(mgr.token, 'GET', '/lead-sources');
  let source = sources.find((s) => s.name === 'Website') ?? sources[0];
  if (!source)
    source = await call(mgr.token, 'POST', '/lead-sources', {
      name: 'Website',
    });
  const items = await call(sales.token, 'GET', '/inventory');
  const product = items.find((i) => i.hsnMasterId) ?? null;
  if (!product)
    throw new Error(
      'No inventory item with an HSN code exists: quotations need one.',
    );
  const sellers = await call(sales.token, 'GET', '/company-gst');
  const seller =
    sellers.find((g) => g.isDefault && g.isActive !== false) ??
    sellers.find((g) => g.isActive !== false);
  if (!seller)
    throw new Error('No company GST registration exists: quotations need one.');
  step(`product "${product.productName}", seller GSTIN ${seller.gstin}`);

  let phone = 9123450100;
  const lead = async (who, customerName, companyName, city) =>
    call(who.token, 'POST', '/leads', {
      customerName,
      companyName,
      phone: String(phone++),
      email: `${customerName.split(' ')[0].toLowerCase()}@example.com`,
      sourceId: source.id,
      inventoryItemId: product.id,
      country: 'IN',
      state: 'Maharashtra',
      city,
    });
  const assign = (leadId, to) =>
    call(mgr.token, 'POST', '/lead-assignments', {
      leadId,
      assignedToId: to.id,
    });
  const qualify = (leadId) =>
    call(pre.token, 'PATCH', `/lead-assignments/${leadId}/qualify`, {
      salesUserId: sales.id,
    });

  // 1-2. New enquiries for the Sales Manager to route.
  await lead(pre, 'Kiran Patil', 'Patil Agro Industries', 'Nashik');
  await lead(pre, 'Meena Joshi', 'Joshi Textiles', 'Pune');
  step('2 new enquiries, unassigned');

  // 3. With Pre-Sales, a call booked for tomorrow.
  const l3 = await lead(pre, 'Rohit Deshmukh', 'Deshmukh Foods', 'Aurangabad');
  await assign(l3.id, pre);
  await call(pre.token, 'POST', '/lead-followups', {
    leadId: l3.id,
    followupDate: `${day(1)}T11:00:00.000Z`,
    remarks: 'Discuss pump capacity for the new cold-storage unit',
  });
  step('Deshmukh Foods: with Pre-Sales, call tomorrow');

  // 4. With Pre-Sales, call done, ready to qualify.
  const l4 = await lead(pre, 'Anita Kulkarni', 'Kulkarni Chemicals', 'Thane');
  await assign(l4.id, pre);
  const f4 = await call(pre.token, 'POST', '/lead-followups', {
    leadId: l4.id,
    followupDate: `${day(0)}T05:00:00.000Z`,
    remarks: 'Intro call: needs 6 dosing pumps by March',
  });
  await call(pre.token, 'PATCH', `/lead-followups/${f4.id}/complete`, {});
  step('Kulkarni Chemicals: call done, ready to qualify');

  // 5. Rejected.
  const l5 = await lead(pre, 'Suresh Rao', 'Rao Engineering', 'Kolhapur');
  await assign(l5.id, pre);
  await call(pre.token, 'PATCH', `/lead-assignments/${l5.id}/reject`, {
    reason: 'No budget this financial year',
  });
  step('Rao Engineering: rejected (no budget)');

  // 6-9. Deals with Sales, at different points of quote-to-cash.
  const deal = async (
    customerName,
    companyName,
    city,
    gstin,
    pan,
    qty,
    price,
  ) => {
    const l = await lead(pre, customerName, companyName, city);
    await assign(l.id, pre);
    await qualify(l.id);
    const customer = await call(sales.token, 'POST', '/customers', {
      customerName: companyName,
      customerType: 'B2B',
      panNumber: pan,
      email: `accounts@${companyName.split(' ')[0].toLowerCase()}.example.com`,
      gstRegistration: {
        gstin,
        legalName: `${companyName} Pvt Ltd`,
        addressLine1: 'Plot 12, MIDC Industrial Area',
        city,
        pincode: '411019',
      },
    });
    const customerRow = customer.customer ?? customer;
    const gst =
      customerRow.gstRegistrations?.[0] ??
      (await call(sales.token, 'GET', `/customers/${customerRow.id}`))
        .gstRegistrations?.[0];
    const opp = await call(sales.token, 'POST', '/opportunities', {
      leadId: l.id,
      title: `${companyName}: ${qty} x ${product.productName}`,
      expectedValue: qty * price,
      probability: 60,
      expectedCloseDate: `${day(30)}`,
      customerId: customerRow.id,
    });
    return { lead: l, customer: customerRow, gst, opp };
  };
  const moveStage = (opp, fromStage, toStage, remarks) =>
    call(sales.token, 'PATCH', `/opportunities/${opp.id}/stage`, {
      fromStage,
      toStage,
      remarks,
    });
  const quote = (d, qty, price) =>
    call(sales.token, 'POST', '/quotations', {
      opportunityId: d.opp.id,
      quoteDate: day(0),
      inventoryItemId: product.id,
      quantity: qty,
      unitPrice: price,
      sellerGstId: seller.id,
      buyerGstId: d.gst.id,
    });
  const toOrder = async (d, qty, price) => {
    await moveStage(d.opp, 'QUALIFIED', 'PROPOSAL', 'Quotation sent');
    const q = await quote(d, qty, price);
    const qId = q.id ?? q.quotation?.id;
    await call(sales.token, 'PATCH', `/quotations/${qId}/approve`, {
      remarks: 'Price agreed on call',
    });
    await moveStage(
      d.opp,
      'PROPOSAL',
      'NEGOTIATION',
      'Customer accepted the quotation',
    );
    const p = await call(sales.token, 'POST', '/proforma-invoices', {
      quotationId: qId,
      issueDate: day(0),
      validityDate: day(15),
    });
    const pId = p.id ?? p.proformaInvoice?.id;
    await call(sales.token, 'PATCH', `/proforma-invoices/${pId}/approve`, {});
    const so = await call(sales.token, 'POST', '/sales-orders', {
      proformaInvoiceId: pId,
      orderDate: day(0),
      inventoryItemId: product.id,
      orderQty: qty,
      sellerGstId: seller.id,
      buyerGstId: d.gst.id,
    });
    const order = so.salesOrder ?? so;
    const total = Number(order.totalAmount);
    const advance = Math.round(total * 0.3 * 100) / 100;
    await call(sales.token, 'POST', '/sales-order-payment-terms/create', {
      salesOrderId: order.id,
      paymentType: 'PARTIAL_ADVANCE',
      advanceAmount: advance,
      balanceAmount: Math.round((total - advance) * 100) / 100,
      creditDays: 30,
      remarks: '30% advance, balance 30 days after dispatch',
    });
    const r = await call(
      fin.token,
      'POST',
      '/sales-order-advance-receipt/create',
      {
        salesOrderId: order.id,
        receiptDate: day(0),
        amountReceived: advance,
        paymentMode: 'BANK_TRANSFER',
        referenceNo: `UTR${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`,
        remarks: '30% advance received',
      },
    );
    const receipt = r.receipt ?? r.advanceReceipt ?? r;
    return { order, receipt, quotationId: qId, proformaId: pId };
  };

  // 6. Shah Pharma: quotation in DRAFT for Sales to approve.
  const d6 = await deal(
    'Vikram Shah',
    'Shah Pharma',
    'Mumbai',
    '27AAACS1111A1Z1',
    'AAACS1111A',
    4,
    85000,
  );
  await moveStage(
    d6.opp,
    'QUALIFIED',
    'PROPOSAL',
    'Requirement confirmed on site visit',
  );
  await quote(d6, 4, 85000);
  step(
    'Shah Pharma: deal at Proposal, quotation in DRAFT (approve it as Sales)',
  );

  // 7. Nair Steel Works: advance paid, Finance to verify.
  const d7 = await deal(
    'Priya Nair',
    'Nair Steel Works',
    'Pune',
    '27AAACN2222B1Z2',
    'AAACN2222B',
    6,
    92000,
  );
  await toOrder(d7, 6, 92000);
  step('Nair Steel Works: order placed, advance waiting for Finance to verify');

  // 8. Mehta Plastics: advance verified, Finance to give commercial approval.
  const d8 = await deal(
    'Arjun Mehta',
    'Mehta Plastics',
    'Nagpur',
    '27AAACM3333C1Z3',
    'AAACM3333C',
    3,
    78000,
  );
  const o8 = await toOrder(d8, 3, 78000);
  await call(
    fin.token,
    'PATCH',
    `/sales-order-advance-receipt/${o8.receipt.id}/verify`,
    {
      verificationStatus: 'VERIFIED',
      remarks: 'Matched with bank statement',
    },
  );
  step(
    'Mehta Plastics: advance verified, waiting for commercial approval (do it as Finance)',
  );

  // 9. Gupta Packaging: fully approved, deal won.
  const d9 = await deal(
    'Neha Gupta',
    'Gupta Packaging',
    'Pune',
    '27AAACG4444D1Z4',
    'AAACG4444D',
    5,
    88000,
  );
  const o9 = await toOrder(d9, 5, 88000);
  await call(
    fin.token,
    'PATCH',
    `/sales-order-advance-receipt/${o9.receipt.id}/verify`,
    {
      verificationStatus: 'VERIFIED',
      remarks: 'Matched with bank statement',
    },
  );
  await call(fin.token, 'POST', '/accounts-commercial-approval/create', {
    salesOrderId: o9.order.id,
    remarks: 'Terms and advance in order',
  });
  await moveStage(d9.opp, 'NEGOTIATION', 'WON', 'Order confirmed and approved');
  step('Gupta Packaging: approved, ready for dispatch, deal WON');

  console.log('Demo data loaded.');
}

main().catch((e) => {
  console.error(`Stopped: ${e.message}`);
  process.exit(1);
});
