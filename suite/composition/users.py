"""Cross-product User lifecycle dispatch."""


def after_insert(doc, method: str | None = None) -> None:
    from suite.drive.install import after_user_insert
    from suite.mail.events import create_user_settings

    after_user_insert(doc, method)
    create_user_settings(doc, method)


def on_trash(doc, method: str | None = None) -> None:
    from suite.drive.install import on_user_trash
    from suite.mail.events import delete_account, delete_user_accounts, delete_user_settings

    on_user_trash(doc, method)
    delete_account(doc, method)
    delete_user_accounts(doc, method)
    delete_user_settings(doc, method)
