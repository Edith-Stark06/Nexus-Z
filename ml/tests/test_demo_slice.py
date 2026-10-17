import pandas as pd

from data import ibm_aml
from ml.make_demo_slice import INJECTED_BANK, raw_frame

COLS = ["ts", "src", "dst", "amount", "currency", "channel", "amount_received", "receiving_currency", "is_laundering"]


def test_raw_slice_loads_back_with_the_same_payments(tmp_path, monkeypatch):
    keys = pd.Index(["001:AAA", "002:BBB", "003:CCC"])  # key i is the pair behind ACC-00000i
    tx = pd.DataFrame([
        [pd.Timestamp("2022-09-09 10:00"), "ACC-000000", "ACC-F00001", 50.0, "US Dollar", "ACH", 50.0, "US Dollar", 0],
        [pd.Timestamp("2022-09-09 10:05"), "ACC-F00001", "ACC-F00002", 50.0, "US Dollar", "ACH", 50.0, "US Dollar", 1],
        [pd.Timestamp("2022-09-09 10:07"), "ACC-000002", "ACC-000001", 7.5, "Euro", "Cheque", 7.5, "Euro", 0],
    ], columns=COLS)
    raw = raw_frame(tx, keys)
    assert raw.loc[0, "from_bank"] == "001" and raw.loc[0, "to_bank"] == INJECTED_BANK and raw.loc[0, "to_account"] == "F00001"

    path = tmp_path / "Demo_Trans.csv"
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n")
        raw.to_csv(f, header=False, index=False)
    monkeypatch.setattr(ibm_aml, "IBM_AML_DIR", tmp_path)
    back = ibm_aml.load_transactions("Demo")

    assert len(back) == 3 and back["is_laundering"].tolist() == [0, 1, 0]
    assert back["amount"].tolist() == [50.0, 50.0, 7.5] and back["channel"].astype(str).tolist() == ["ACH", "ACH", "Cheque"]
    # the same accounts are the same accounts: payment 1 ends where payment 2 starts, and payment 3 shares no account with them
    assert back.loc[0, "dst"] == back.loc[1, "src"]
    assert len({back.loc[2, "src"], back.loc[2, "dst"]} & {back.loc[0, "src"], back.loc[0, "dst"], back.loc[1, "dst"]}) == 0
