// These are shop capabilities, not phrases or commands owners have to memorize.
export const shopTools={
  enable:'Make a named or previously identified menu item available.',
  disable:'Mark a menu item sold out for today.',
  billBalance:'Read the received and outstanding amounts of one identified customer bill.',
  billPayment:'Record or correct money received on an existing bill. Supports full, part, additional instalment, remaining due and payment method.',
  order:'Start, revise or clear an order draft, or issue its bill with the shop menu, phrases and GST.',
  vendor:'Record supplier payments, purchases, orders, opening balances or corrections to a posted entry. Includes completed payments stated conversationally.',
  menuAdd:'Add one or more dishes with prices and portions.',
  menuEdit:'Change the price, name, category or portion of an existing dish.',
  phraseSave:'Teach or revise a saved menu shorthand and the dishes it means.',
  phraseDelete:'Remove a saved menu shorthand.',
  profileEdit:'Change owner name, business name, city or GST percentage. Registered phone is immutable.',
  invoiceCheck:'Compare spoken ordered and delivered quantities with a saved supplier invoice.',
  menuPhoto:'Open the menu photo import and review flow when a photo is needed.',
  invoicePhoto:'Open the vendor invoice upload flow for a new delivery document.',
  bankPhoto:'Open the payment QR photo and recipient verification flow.',
};
export const toolNames=Object.keys(shopTools);
