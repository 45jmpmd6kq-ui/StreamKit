# -*- coding: utf-8 -*-
"""Recadre les captures pour le deck.

    node_modules\\.bin\\electron scripts/captures.mjs   puis   python scripts/recadrer.py

Les captures brutes font 2544 x 1356. Posees entieres sur une slide, leur texte
devient illisible : on en extrait la fenetre ou le bloc qui compte. Les
coordonnees sont figees ici plutot que refaites a la main a chaque passe.
"""

from pathlib import Path

from PIL import Image

CAPTURES = Path(__file__).resolve().parent.parent / "doc" / "captures"
FOND = (10, 9, 14)

# (source, boite) — boite en pixels de la capture brute.
DECOUPES = {
    "c-rail.png": ("01-accueil.png", (10, 120, 550, 990)),
    "c-bandeau.png": ("01-accueil.png", (0, 0, 900, 108)),
    "c-twitch.png": ("02-twitch.png", (652, 117, 1891, 1202)),
    "c-spotify.png": ("03-connecteurs.png", (610, 318, 2054, 1221)),
    "c-module.png": ("04-module.png", (559, 114, 2470, 1144)),
    "c-overlay.png": ("05-overlays.png", (585, 195, 2072, 560)),
    "c-maj.png": ("07-maj.png", (652, 286, 1891, 1066)),
}


def recadrer():
    for dst, (src, boite) in DECOUPES.items():
        im = Image.open(CAPTURES / src).crop(boite)
        im.save(CAPTURES / dst)
        print("%-16s %sx%s" % (dst, im.size[0], im.size[1]))


def journal():
    """Le journal, sans les 120 px de vide entre la barre de filtres et les
    lignes : l'instance de capture n'a que quatre lignes au compteur."""
    src = Image.open(CAPTURES / "06-journal.png")
    haut = src.crop((0, 920, 2544, 1015))
    bas = src.crop((0, 1140, 2544, 1356))
    out = Image.new("RGB", (2544, haut.height + bas.height), FOND)
    out.paste(haut, (0, 0))
    out.paste(bas, (0, haut.height))
    out.save(CAPTURES / "c-journal.png")
    print("%-16s %sx%s" % ("c-journal.png", out.size[0], out.size[1]))


if __name__ == "__main__":
    recadrer()
    journal()
