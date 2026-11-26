-- SQLite previously stored fractional servings using dynamic typing in an
-- INTEGER-affinity column. Declare the unit and enforce the API's quarter step.
CREATE TABLE lines_v2 (
  bill TEXT NOT NULL REFERENCES bills(id),
  item TEXT NOT NULL REFERENCES menu(id),
  name TEXT NOT NULL,
  variant TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (typeof(price) = 'integer' AND price > 0),
  quantity REAL NOT NULL CHECK (
    quantity BETWEEN 0.25 AND 99 AND quantity * 4 = CAST(quantity * 4 AS INTEGER)
  ),
  PRIMARY KEY (bill, item)
);
INSERT INTO lines_v2 (rowid, bill, item, name, variant, price, quantity)
SELECT rowid, bill, item, name, variant, price, quantity FROM lines;
DROP TABLE lines;
ALTER TABLE lines_v2 RENAME TO lines;
CREATE INDEX bills_by_business_date ON bills(restaurant, created);
CREATE INDEX vendor_history ON vendor_events(restaurant, id);
CREATE INDEX vendor_corrections ON vendor_edits(restaurant, id);
CREATE INDEX session_expiry ON phone_sessions(expires);
