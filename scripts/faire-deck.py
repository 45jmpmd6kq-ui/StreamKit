# -*- coding: utf-8 -*-
"""Genere le deck de presentation + mode operatoire de StreamKit.

    python scripts/faire-deck.py

Les captures viennent de doc/captures/ (voir scripts/captures.mjs). La charte
reprend celle du dashboard : meme fond, meme violet, memes cartes — un lecteur
qui passe des slides a l'application ne change pas d'univers.
"""

import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Cm, Pt

RACINE = Path(__file__).resolve().parent.parent
CAPTURES = RACINE / "doc" / "captures"
SORTIE = RACINE / "StreamKit_Presentation.pptx"

# Le numero de version se lit dans package.json : ecrit en dur, il mentirait
# des la publication suivante.
VERSION = json.loads((RACINE / "package.json").read_text(encoding="utf-8"))["version"]

# --- Charte ----------------------------------------------------------------

FOND = RGBColor(0x14, 0x12, 0x1A)
SURFACE = RGBColor(0x1E, 0x1B, 0x26)
SURFACE_HAUTE = RGBColor(0x26, 0x22, 0x32)
BORDURE = RGBColor(0x33, 0x2D, 0x42)
TEXTE = RGBColor(0xF3, 0xF1, 0xF8)
DOUX = RGBColor(0xA4, 0x9E, 0xB6)
ACCENT = RGBColor(0xA9, 0x70, 0xFF)
VERT = RGBColor(0x46, 0xD1, 0x7F)
ORANGE = RGBColor(0xE0, 0xA3, 0x3E)
ROUGE = RGBColor(0xE0, 0x55, 0x4E)
BLANC = RGBColor(0xFF, 0xFF, 0xFF)

POLICE = "Segoe UI"
POLICE_MONO = "Consolas"

# Slide 16:9 en centimetres.
L_SLIDE = 33.867
H_SLIDE = 19.05
MARGE = 2.0
L_UTILE = L_SLIDE - 2 * MARGE

# --- Briques ---------------------------------------------------------------


def typo(texte):
    """Apostrophe typographique : l'application en utilise une, le deck aussi."""
    return texte.replace("'", "’")


def sans_ombre(forme):
    """python-pptx laisse l'ombre du theme par defaut : elle salit tout."""
    forme.shadow.inherit = False


def rect(slide, x, y, l, h, fond=None, bordure=None, epaisseur=1.0, arrondi=None):
    forme_type = MSO_SHAPE.ROUNDED_RECTANGLE if arrondi is not None else MSO_SHAPE.RECTANGLE
    f = slide.shapes.add_shape(forme_type, Cm(x), Cm(y), Cm(l), Cm(h))
    if arrondi is not None:
        f.adjustments[0] = arrondi
    if fond is None:
        f.fill.background()
    else:
        f.fill.solid()
        f.fill.fore_color.rgb = fond
    if bordure is None:
        f.line.fill.background()
    else:
        f.line.color.rgb = bordure
        f.line.width = Pt(epaisseur)
    sans_ombre(f)
    f.text_frame.word_wrap = True
    return f


def zone_texte(slide, x, y, l, h, ancre=MSO_ANCHOR.TOP):
    z = slide.shapes.add_textbox(Cm(x), Cm(y), Cm(l), Cm(h))
    tf = z.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = ancre
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    return tf


def para(tf, texte, taille=14, couleur=TEXTE, gras=False, espace_apres=6,
         interligne=1.15, alignement=PP_ALIGN.LEFT, police=POLICE, premier=False,
         espace_avant=0):
    p = tf.paragraphs[0] if premier else tf.add_paragraph()
    p.alignment = alignement
    p.space_after = Pt(espace_apres)
    p.space_before = Pt(espace_avant)
    p.line_spacing = interligne
    r = p.add_run()
    r.text = typo(texte)
    r.font.size = Pt(taille)
    r.font.bold = gras
    r.font.color.rgb = couleur
    r.font.name = police
    return p


def riche(tf, morceaux, taille=14, espace_apres=6, interligne=1.15, premier=False,
          alignement=PP_ALIGN.LEFT):
    """Un paragraphe fait de plusieurs bouts : (texte, couleur, gras, police)."""
    p = tf.paragraphs[0] if premier else tf.add_paragraph()
    p.alignment = alignement
    p.space_after = Pt(espace_apres)
    p.line_spacing = interligne
    for bout in morceaux:
        texte, couleur = bout[0], bout[1]
        gras = bout[2] if len(bout) > 2 else False
        police = bout[3] if len(bout) > 3 else POLICE
        r = p.add_run()
        r.text = typo(texte)
        r.font.size = Pt(taille)
        r.font.bold = gras
        r.font.color.rgb = couleur
        r.font.name = police
    return p


def nouvelle(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    rect(s, 0, 0, L_SLIDE, H_SLIDE, fond=FOND)
    return s


def titre(slide, texte, surtitre=None, sous=None):
    """Bandeau de titre commun : surtitre, titre, filet violet, chapeau."""
    y = 1.5
    if surtitre:
        tf = zone_texte(slide, MARGE, y, L_UTILE, 0.7)
        para(tf, surtitre.upper(), taille=11, couleur=ACCENT, gras=True,
             espace_apres=0, premier=True)
        y += 0.85

    tf = zone_texte(slide, MARGE, y, L_UTILE, 1.4)
    para(tf, texte, taille=28, couleur=TEXTE, gras=True, espace_apres=0, premier=True)
    y += 1.55

    filet = rect(slide, MARGE, y, 2.6, 0.09, fond=ACCENT)
    sans_ombre(filet)
    y += 0.55

    if sous:
        tf = zone_texte(slide, MARGE, y, L_UTILE * 0.82, 1.2)
        para(tf, sous, taille=14, couleur=DOUX, espace_apres=0, premier=True)
        y += 1.15

    return y


def image(slide, nom, x, y, largeur=None, hauteur=None, cadre=True):
    """Pose une capture et lui donne un liseré, pour la détacher du fond."""
    from PIL import Image as PILImage

    chemin = CAPTURES / nom
    with PILImage.open(chemin) as im:
        ratio = im.size[0] / im.size[1]

    if largeur is None:
        largeur = hauteur * ratio
    if hauteur is None:
        hauteur = largeur / ratio

    if cadre:
        rect(slide, x - 0.12, y - 0.12, largeur + 0.24, hauteur + 0.24,
             fond=None, bordure=BORDURE, epaisseur=1.0, arrondi=0.03)
    slide.shapes.add_picture(str(chemin), Cm(x), Cm(y), Cm(largeur), Cm(hauteur))
    return largeur, hauteur


def pastille(slide, n, x, y, d=0.82, fond=ACCENT, couleur=BLANC):
    """Rond numéroté : les étapes et les renvois vers les captures."""
    f = slide.shapes.add_shape(MSO_SHAPE.OVAL, Cm(x), Cm(y), Cm(d), Cm(d))
    f.fill.solid()
    f.fill.fore_color.rgb = fond
    f.line.fill.background()
    sans_ombre(f)
    tf = f.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    para(tf, str(n), taille=13, couleur=couleur, gras=True, espace_apres=0,
         alignement=PP_ALIGN.CENTER, premier=True)
    return f


def etapes(slide, x, y, largeur, lignes, ecart=1.62, taille=13.5, debut=1):
    """Liste numérotée : pastille + titre gras + explication en dessous."""
    for i, (fort, suite) in enumerate(lignes):
        cy = y + i * ecart
        pastille(slide, debut + i, x, cy - 0.03, d=0.78)
        tf = zone_texte(slide, x + 1.15, cy - 0.08, largeur - 1.15, ecart)
        riche(tf, [(fort, TEXTE, True)], taille=taille, espace_apres=2, premier=True)
        if suite:
            para(tf, suite, taille=taille - 1.5, couleur=DOUX, espace_apres=0,
                 interligne=1.12)
    return y + len(lignes) * ecart


def carte(slide, x, y, l, h, titre_carte, corps, icone=None, accent=None):
    c = rect(slide, x, y, l, h, fond=SURFACE, bordure=BORDURE, arrondi=0.06)
    tf = c.text_frame
    tf.margin_left = tf.margin_right = Cm(0.6)
    tf.margin_top = Cm(0.55)
    tf.margin_bottom = Cm(0.5)
    tf.vertical_anchor = MSO_ANCHOR.TOP
    if icone:
        para(tf, icone, taille=20, espace_apres=5, premier=True, couleur=TEXTE)
        para(tf, titre_carte, taille=14.5, couleur=accent or TEXTE, gras=True, espace_apres=4)
    else:
        para(tf, titre_carte, taille=14.5, couleur=accent or TEXTE, gras=True,
             espace_apres=4, premier=True)
    para(tf, corps, taille=12, couleur=DOUX, espace_apres=0, interligne=1.15)
    return c


def rangee(nb, largeur_totale=L_UTILE, gouttiere=0.55, x0=MARGE):
    """Positions d'une rangée régulière : x_i = x0 + i·(l + gouttière)."""
    l = (largeur_totale - gouttiere * (nb - 1)) / nb
    return [x0 + i * (l + gouttiere) for i in range(nb)], l


def encadre(slide, x, y, l, h, titre_bloc, corps, couleur=ORANGE):
    """Bandeau d'alerte : même grammaire visuelle que dans l'application."""
    c = rect(slide, x, y, l, h, fond=SURFACE_HAUTE, bordure=couleur, arrondi=0.08)
    barre = rect(slide, x, y, 0.13, h, fond=couleur)
    sans_ombre(barre)
    tf = c.text_frame
    tf.margin_left = Cm(0.75)
    tf.margin_right = Cm(0.6)
    tf.margin_top = Cm(0.45)
    tf.margin_bottom = Cm(0.4)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    para(tf, titre_bloc, taille=13.5, couleur=couleur, gras=True, espace_apres=3,
         premier=True)
    para(tf, corps, taille=12, couleur=TEXTE, espace_apres=0, interligne=1.15)
    return c


def pied(slide, texte):
    tf = zone_texte(slide, MARGE, H_SLIDE - 1.35, L_UTILE, 0.7)
    para(tf, texte, taille=10.5, couleur=DOUX, espace_apres=0, premier=True)


def numero(slide, n, total):
    tf = zone_texte(slide, L_SLIDE - MARGE - 4, H_SLIDE - 1.35, 4, 0.7)
    para(tf, "%d / %d" % (n, total), taille=10.5, couleur=RGBColor(0x63, 0x5D, 0x75),
         espace_apres=0, alignement=PP_ALIGN.RIGHT, premier=True)


def fleche(slide, x, y, l=1.1, couleur=ACCENT):
    f = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Cm(x), Cm(y), Cm(l), Cm(0.45))
    f.fill.solid()
    f.fill.fore_color.rgb = couleur
    f.line.fill.background()
    sans_ombre(f)
    return f


# --- Les slides ------------------------------------------------------------


def slide_titre(prs):
    s = nouvelle(prs)

    # Halo violet : un simple aplat adouci ferait mieux, mais un dégradé PowerPoint
    # sur fond sombre bande ; deux rectangles suffisent à poser l'ambiance.
    bande = rect(s, 0, 0, 0.55, H_SLIDE, fond=ACCENT)
    sans_ombre(bande)

    tf = zone_texte(s, MARGE + 1.2, 5.4, L_UTILE - 2, 1.0)
    para(tf, "TES OUTILS DE STREAM, EN UN SEUL ENDROIT", taille=13, couleur=ACCENT,
         gras=True, espace_apres=0, premier=True)

    tf = zone_texte(s, MARGE + 1.2, 6.6, L_UTILE - 2, 3.0)
    para(tf, "StreamKit", taille=66, couleur=TEXTE, gras=True, espace_apres=0,
         premier=True)

    tf = zone_texte(s, MARGE + 1.2, 10.4, 20.5, 3.0)
    para(tf, "Une application à installer une fois. Des modules à activer selon le "
             "jeu. Des corrections qui arrivent toutes seules, sans rien "
             "reconfigurer.",
         taille=17, couleur=DOUX, espace_apres=0, interligne=1.3, premier=True)

    xs, l = rangee(3, largeur_totale=18.0, gouttiere=0.5, x0=MARGE + 1.2)
    for x, (haut, bas) in zip(xs, [(VERSION, "version publiée"),
                                   ("5", "modules disponibles"),
                                   ("2 min", "pour installer")]):
        tf = zone_texte(s, x, 14.6, l, 2.0)
        para(tf, haut, taille=24, couleur=ACCENT, gras=True, espace_apres=1, premier=True)
        para(tf, bas, taille=11.5, couleur=DOUX, espace_apres=0)

    pied(s, "Windows · septembre 2026")
    return s


def slide_probleme(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Aujourd'hui, chaque outil vit dans son coin",
              surtitre="Le point de départ",
              sous="Quatre outils, quatre dossiers, quatre façons de les lancer — et "
                   "un correctif qui se distribue à la main.")

    xs, l = rangee(4)
    cartes = [
        ("📁", "Un dossier par outil",
         "Bot musique ici, roue Rocket League là, overlay Valorant ailleurs. "
         "Autant de raccourcis et de fenêtres noires."),
        ("⚙️", "Une configuration par outil",
         "Les mêmes identifiants Twitch recopiés dans chaque outil, à chaque "
         "réinstallation."),
        ("📦", "Un correctif = tout renvoyer",
         "Un zip, un message, et l'espoir que personne n'écrase ses réglages en "
         "décompressant."),
        ("❓", "Aucune visibilité",
         "Est-ce que ça tourne ? On l'apprend quand le chat le fait remarquer."),
    ]
    for x, (ic, t, c) in zip(xs, cartes):
        carte(s, x, y + 0.55, l, 6.1, t, c, icone=ic)

    encadre(s, MARGE, y + 7.3, L_UTILE, 2.0,
            "Le vrai coût n'est pas l'installation, c'est la maintenance",
            "Chaque correction se paie en messages, en captures d'écran et en "
            "« ça remarche pas chez moi ».", couleur=ORANGE)

    numero(s, n, total)
    return s


def slide_solution(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "StreamKit, en une phrase", surtitre="La réponse")

    grand = rect(s, MARGE, y + 0.5, L_UTILE, 4.2, fond=SURFACE, bordure=ACCENT,
                 epaisseur=1.25, arrondi=0.05)
    tf = grand.text_frame
    tf.margin_left = tf.margin_right = Cm(1.4)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    riche(tf, [("Une seule application qui contient tous tes outils, ", TEXTE, False),
               ("et qui se met à jour toute seule.", ACCENT, True)],
          taille=25, espace_apres=0, interligne=1.25, premier=True,
          alignement=PP_ALIGN.CENTER)

    xs, l = rangee(3)
    trio = [
        ("1 · Tu installes une fois",
         "Un fichier .exe, un double-clic. Pas de Node.js, pas de ligne de commande, "
         "pas de droits administrateur."),
        ("2 · Tu actives ce que tu veux",
         "Les modules sont rangés par jeu. Tu allumes le bot musique, tu laisses le "
         "reste éteint : rien ne tourne pour rien."),
        ("3 · Je corrige, tu reçois",
         "Un bouton apparaît dans ta fenêtre. Un clic, StreamKit redémarre à jour, "
         "et tes réglages sont toujours là."),
    ]
    for x, (t, c) in zip(xs, trio):
        carte(s, x, y + 5.4, l, 4.0, t, c, accent=ACCENT)

    pied(s, "Le socle est commun : une seule connexion Twitch, un seul journal, un "
            "seul écran de réglages pour tous les modules.")
    numero(s, n, total)
    return s


def slide_modules(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Les modules, rangés par jeu", surtitre="Ce qu'il y a dedans",
              sous="Un module = une fonctionnalité. La colonne de gauche est ta "
                   "télécommande.")

    image(s, "c-rail.png", MARGE, y + 0.6, hauteur=9.6)

    x = MARGE + 6.6
    largeur = L_SLIDE - MARGE - x
    familles = [
        ("🟣  Twitch", ACCENT, [
            ("Clips", "La commande !clip découpe les 30 dernières secondes. Ce qui "
                      "est écrit après devient le titre du clip."),
            ("Bot Musique", "Les viewers dépensent leurs points de chaîne, le morceau "
                            "part dans ta file Spotify. Refus et passage inclus."),
        ]),
        ("🚀  Rocket League", RGBColor(0x62, 0xA8, 0xFF), [
            ("Random Car", "Une récompense tire une carrosserie au hasard "
                                  "parmi celles que tu possèdes, en machine à sous "
                                  "sur l'overlay."),
        ]),
        ("🔫  Valorant", RGBColor(0xFF, 0x6B, 0x6B), [
            ("Overlay W/L", "Victoires, défaites et RR gagnés depuis le début "
                                   "du live, affichés en direct."),
        ]),
    ]

    cy = y + 0.6
    for nom, couleur, modules in familles:
        tf = zone_texte(s, x, cy, largeur, 0.8)
        para(tf, nom, taille=15, couleur=couleur, gras=True, espace_apres=0, premier=True)
        cy += 0.80
        for titre_mod, desc in modules:
            tf = zone_texte(s, x + 0.5, cy, largeur - 0.5, 1.6)
            para(tf, titre_mod, taille=13.5, couleur=TEXTE, gras=True, espace_apres=2,
                 premier=True)
            para(tf, desc, taille=12, couleur=DOUX, espace_apres=0, interligne=1.13)
            cy += 1.60
        cy += 0.10

    encadre(s, x, cy + 0.15, largeur, 2.3, "La suite",
            "League of Legends (bilan victoires/défaites, timers de flash) et deux "
            "modules Rocket League de plus sont en préparation.", couleur=ACCENT)

    numero(s, n, total)
    return s


def slide_live(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Ce qui se passe pendant un live", surtitre="Le fonctionnement",
              sous="StreamKit écoute ta chaîne et pilote tes outils. Tout se passe "
                   "sur ton PC.")

    haut = y + 1.6
    h_bloc = 4.6

    # Trois colonnes : la source, StreamKit, les sorties. Les flèches sont
    # centrées sur le milieu de l'intervalle entre deux blocs.
    l_bloc = 8.6
    ecart = (L_UTILE - 3 * l_bloc) / 2
    xs = [MARGE + i * (l_bloc + ecart) for i in range(3)]

    carte(s, xs[0], haut, l_bloc, h_bloc, "Twitch",
          "Un viewer dépense ses points de chaîne, ou tape une commande dans le "
          "chat.", icone="🟣")
    milieu = rect(s, xs[1], haut, l_bloc, h_bloc, fond=SURFACE, bordure=ACCENT,
                  epaisseur=1.5, arrondi=0.06)
    tf = milieu.text_frame
    tf.margin_left = tf.margin_right = Cm(0.6)
    tf.margin_top = Cm(0.55)
    para(tf, "🎛️", taille=20, espace_apres=5, premier=True, couleur=TEXTE)
    para(tf, "StreamKit, sur ton PC", taille=14.5, couleur=ACCENT, gras=True,
         espace_apres=4)
    para(tf, "Le module concerné réagit : il vérifie, il agit, et il écrit ce qu'il "
             "a fait dans le journal.", taille=12, couleur=DOUX, espace_apres=0,
         interligne=1.15)

    carte(s, xs[2], haut, l_bloc, h_bloc, "Spotify · OBS",
          "Le morceau part dans ta file d'attente, l'overlay s'anime devant tes "
          "viewers.", icone="🎵")

    for i in range(2):
        centre = xs[i] + l_bloc + ecart / 2
        fleche(s, centre - 0.55, haut + h_bloc / 2 - 0.22, l=1.1)

    xs2, l2 = rangee(2)
    carte(s, xs2[0], haut + h_bloc + 1.2, l2, 3.5, "Ferme la fenêtre sans crainte",
          "StreamKit continue de tourner près de l'horloge. La fenêtre n'est qu'un "
          "tableau de bord, pas le programme.", accent=VERT)
    carte(s, xs2[1], haut + h_bloc + 1.2, l2, 3.5, "Aucun serveur, aucun compte",
          "Rien ne transite par un service tiers : ta chaîne parle directement à ton "
          "PC.", accent=VERT)

    numero(s, n, total)
    return s


def slide_maj(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "La mise à jour se fait toute seule", surtitre="Le point clé",
              sous="C'est la raison d'être de StreamKit : corriger une fois, et que "
                   "tout le monde en profite.")

    image(s, "c-maj.png", MARGE, y + 0.9, largeur=15.4)

    x = MARGE + 16.6
    largeur = L_SLIDE - MARGE - x
    etapes(s, x, y + 1.0, largeur, [
        ("Un bouton apparaît en haut de ta fenêtre",
         "Jamais une notification Windows : une bulle système pendant que tu captures "
         "ton écran serait diffusée à tes viewers."),
        ("Un clic, et c'est fait",
         "StreamKit se ferme, se remplace et redémarre tout seul. Une quinzaine de "
         "secondes."),
        ("Tes réglages ne bougent pas",
         "Ils sont rangés ailleurs que le programme. Même une désinstallation suivie "
         "d'une réinstallation les retrouve."),
    ], ecart=2.5)

    encadre(s, x, y + 9.0, largeur, 2.6, "À garder en tête",
            "Une correction n'est visible qu'après la mise à jour : la version qui "
            "tourne au moment où tu lis le message est encore l'ancienne.",
            couleur=ORANGE)

    numero(s, n, total)
    return s


def slide_securite(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Tes codes restent chez toi", surtitre="Sécurité",
              sous="StreamKit n'a pas de serveur. Il n'y a personne au milieu.")

    xs, l = rangee(3)
    trio = [
        ("🏠", "Tout tourne en local",
         "Aucune donnée n'est envoyée nulle part. StreamKit parle directement à "
         "Twitch et à Spotify, depuis ton PC."),
        ("🔑", "Tes propres applications",
         "Tu crées ton application Twitch et ton application Spotify. Personne "
         "d'autre — moi compris — n'a d'accès à ta chaîne."),
        ("📂", "Un dossier à ne pas partager",
         "Réglages et jetons vivent dans %APPDATA%\\StreamKit. C'est le seul endroit "
         "sensible de toute l'installation."),
    ]
    for x, (ic, t, c) in zip(xs, trio):
        carte(s, x, y + 0.7, l, 4.9, t, c, icone=ic)

    encadre(s, MARGE, y + 6.4, L_UTILE, 2.6, "⚠  Ne partage jamais ce dossier",
            "Ni par message, ni dans un zip, ni dans une capture d'écran. Il contient "
            "de quoi agir sur ta chaîne à ta place. (Windows + R, puis "
            "%APPDATA%\\StreamKit pour y aller.)", couleur=ROUGE)

    numero(s, n, total)
    return s


def slide_separateur(prs, n, total):
    s = nouvelle(prs)
    bande = rect(s, 0, 0, 0.55, H_SLIDE, fond=ACCENT)
    sans_ombre(bande)

    tf = zone_texte(s, MARGE + 1.2, 7.0, L_UTILE - 2, 1.0)
    para(tf, "DEUXIÈME PARTIE", taille=13, couleur=ACCENT, gras=True, espace_apres=0,
         premier=True)

    tf = zone_texte(s, MARGE + 1.2, 8.2, L_UTILE - 2, 2.4)
    para(tf, "Mode opératoire", taille=46, couleur=TEXTE, gras=True, espace_apres=0,
         premier=True)

    tf = zone_texte(s, MARGE + 1.2, 11.4, 21.0, 1.6)
    para(tf, "De rien du tout à un overlay qui tourne dans OBS : six étapes, une "
             "dizaine de minutes.", taille=16, couleur=DOUX, espace_apres=0,
         interligne=1.3, premier=True)

    numero(s, n, total)
    return s


def slide_installer(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Installer StreamKit", surtitre="Étape 1 · deux minutes")

    x_gauche = MARGE
    largeur = 17.0
    etapes(s, x_gauche, y + 0.7, largeur, [
        ("Télécharge le programme d'installation",
         "Sur la page des versions du dépôt, prends le fichier "
         "StreamKit-Setup-" + VERSION + ".exe (le plus récent)."),
        ("Double-clique dessus",
         "Il n'y a rien à choisir : ni dossier, ni options, ni redémarrage. "
         "L'installation dure quelques secondes."),
        ("Laisse passer l'avertissement Windows",
         "« Windows a protégé votre ordinateur » → Informations complémentaires → "
         "Exécuter quand même. Une seule fois."),
        ("StreamKit s'ouvre",
         "Une fenêtre sombre, une colonne de modules à gauche, un indicateur rouge en "
         "haut : c'est normal, rien n'est encore connecté."),
    ], ecart=2.35)

    x_droite = MARGE + 18.4
    l_droite = L_SLIDE - MARGE - x_droite

    c = rect(s, x_droite, y + 0.7, l_droite, 4.4, fond=SURFACE, bordure=BORDURE,
             arrondi=0.06)
    tf = c.text_frame
    tf.margin_left = tf.margin_right = Cm(0.6)
    tf.margin_top = Cm(0.55)
    para(tf, "Où télécharger", taille=14.5, couleur=ACCENT, gras=True, espace_apres=6,
         premier=True)
    para(tf, "github.com/45jmpmd6kq-ui/StreamKit/releases", taille=11.5,
         couleur=TEXTE, police=POLICE_MONO, espace_apres=8, interligne=1.2)
    para(tf, "Le fichier fait environ 80 Mo : tout est dedans, il n'y a rien d'autre "
             "à installer.", taille=12, couleur=DOUX, espace_apres=0, interligne=1.15)

    encadre(s, x_droite, y + 5.7, l_droite, 4.6,
            "Pourquoi cet avertissement ?",
            "Le programme n'est pas signé numériquement : le certificat coûte "
            "plusieurs centaines d'euros par an. Windows prévient qu'il ne connaît "
            "pas l'éditeur, pas que le fichier est dangereux.", couleur=ORANGE)

    # Ce que le streamer voit juste après : l'indicateur rouge est normal, et
    # c'est aussi le bouton de l'étape suivante.
    image(s, "c-bandeau.png", x_gauche, y + 10.4, largeur=11.4)
    tf = zone_texte(s, x_gauche, y + 12.25, 16.0, 1.0)
    para(tf, "Au premier lancement : l'indicateur est rouge, rien n'est encore "
             "connecté.", taille=12, couleur=DOUX, espace_apres=0, premier=True)

    pied(s, "Aucun droit administrateur n'est demandé : StreamKit s'installe dans ton "
            "profil utilisateur.")
    numero(s, n, total)
    return s


def slide_twitch(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Connecter ta chaîne Twitch", surtitre="Étape 2 · trois minutes",
              sous="À faire une seule fois. Tous les modules Twitch se serviront de "
                   "cette connexion.")

    # Twitch se configure sur l'écran Connecteurs, comme Spotify : même carte,
    # même geste. La slide suivante n'aura donc rien de nouveau à apprendre.
    image(s, "c-twitch.png", MARGE, y + 0.7, largeur=17.0)

    x = MARGE + 18.2
    largeur = L_SLIDE - MARGE - x
    etapes(s, x, y + 0.6, largeur, [
        ("Clique sur l'indicateur rouge",
         "En haut de la fenêtre. Il t'amène sur l'écran Connecteurs, carte Twitch "
         "ouverte."),
        ("Ouvre la console développeur Twitch",
         "Gratuit, avec ton compte Twitch habituel."),
        ("Crée une application",
         "Nom : StreamKit. Catégorie : Chat Bot."),
        ("Colle l'adresse de retour affichée",
         "Au caractère près : c'est la cause numéro un des refus d'autorisation."),
        ("Renseigne chaîne, ID et secret",
         "Puis « Enregistrer »."),
        ("Clique sur « Connecter »",
         "Une page Twitch s'ouvre : Autoriser. L'indicateur passe au vert."),
    ], ecart=1.95)

    numero(s, n, total)
    return s


def slide_spotify(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Connecter Spotify", surtitre="Étape 3 · seulement pour le bot musique",
              sous="Les services externes se configurent au même endroit : l'écran "
                   "Connecteurs. Les modules y puisent tout seuls.")

    image(s, "c-spotify.png", MARGE, y + 0.8, largeur=17.4)

    x = MARGE + 18.6
    largeur = L_SLIDE - MARGE - x
    etapes(s, x, y + 0.9, largeur, [
        ("Ouvre Connecteurs, puis la carte Spotify",
         "Dans la colonne de gauche, juste sous « Vue d'ensemble »."),
        ("Crée ton application Spotify",
         "Sur le tableau de bord développeur : Create app, nom et description libres, "
         "coche « Web API »."),
        ("Colle l'adresse de retour affichée",
         "Elle est donnée dans la carte, avec un bouton Copier. Là encore : au "
         "caractère près."),
        ("ID + secret, puis Connecter",
         "Spotify demande ton accord, et le nom de ton compte s'affiche à côté du "
         "connecteur."),
    ], ecart=2.2)

    encadre(s, x, y + 9.5, largeur, 2.7, "Pourquoi ta propre application ?",
            "Une application Spotify partagée est plafonnée à 25 utilisateurs à "
            "inscrire un par un. Avec une application par streamer, la limite "
            "n'existe pas.", couleur=ACCENT)

    numero(s, n, total)
    return s


def slide_activer(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Activer un module", surtitre="Étape 4",
              sous="Chaque module a son écran : une description, ses réglages, ses "
                   "overlays, son interrupteur.")

    l_img, h_img = image(s, "c-module.png", MARGE, y + 0.8, largeur=18.6)

    # Un seul renvoi posé sur la capture : l'interrupteur, dans un coin vide.
    # Un second, sur la zone des réglages, recouvrait le texte de l'écran.
    pastille(s, 3, MARGE + l_img - 1.35, y + 1.0, d=0.78)

    x = MARGE + 19.8
    largeur = L_SLIDE - MARGE - x
    etapes(s, x, y + 0.9, largeur, [
        ("Choisis le module à gauche",
         "Les catégories se replient : tu ne vois que les jeux qui t'intéressent."),
        ("Règle ce que tu veux",
         "Chaque champ est expliqué sous son titre. Un champ obligatoire vide empêche "
         "le module de démarrer, et il te le dit."),
        ("Bascule l'interrupteur",
         "En haut à droite de l'écran du module. La pastille passe au vert quand il "
         "tourne."),
    ], ecart=2.55)

    encadre(s, x, y + 8.9, largeur, 2.5, "Pas de redémarrage",
            "Les réglages s'appliquent immédiatement, même en plein live.",
            couleur=VERT)

    numero(s, n, total)
    return s


def slide_obs(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Poser l'overlay dans OBS", surtitre="Étape 5",
              sous="Chaque module qui affiche quelque chose donne une adresse à "
                   "coller dans OBS.")

    l_img, h_img = image(s, "c-overlay.png", MARGE, y + 0.8, largeur=20.0)

    # L'encadré occupe la place laissée libre à droite du bandeau, plutôt que de
    # déborder sous les cartes.
    x_alerte = MARGE + l_img + 1.0
    encadre(s, x_alerte, y + 0.8, L_SLIDE - MARGE - x_alerte, h_img,
            "Un overlay reste vide ?",
            "Vérifie que StreamKit tourne (l'icône près de l'horloge), puis clic droit "
            "sur la source dans OBS ▸ Actualiser.", couleur=ORANGE)

    y2 = y + h_img + 1.6
    xs, l = rangee(4)
    quatuor = [
        ("1 · Copie l'adresse",
         "Bouton Copier, sur l'écran du module."),
        ("2 · Ajoute une source dans OBS",
         "Sources ▸ + ▸ Navigateur. Donne-lui le nom que tu veux."),
        ("3 · Colle l'adresse",
         "Dans le champ URL. Largeur 1920, Hauteur 1080 : l'overlay se place tout "
         "seul dans le coin prévu."),
        ("4 · Place la source",
         "Ajoute ?demo=1 à la fin de l'adresse pour voir un exemple, positionne, puis "
         "retire-le."),
    ]
    for x, (t, c) in zip(xs, quatuor):
        carte(s, x, y2, l, 4.6, t, c, accent=ACCENT)

    numero(s, n, total)
    return s


def slide_pendant(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Pendant le live", surtitre="Étape 6",
              sous="StreamKit vit près de l'horloge, en bas à droite de l'écran.")

    xs, l = rangee(3)
    trio = [
        ("🖱️", "Fermer la fenêtre ne coupe rien",
         "La croix range StreamKit près de l'horloge. Les modules continuent de "
         "tourner : c'est fait pour."),
        ("↩️", "Clic droit sur l'icône",
         "Ouvrir le tableau de bord, ou tout arrêter. Double-clic : la fenêtre "
         "revient."),
        ("⚡", "Démarrer avec Windows",
         "Roue crantée en haut à droite → Démarrer avec Windows. Il se lance "
         "directement près de l'horloge, sans fenêtre."),
    ]
    for x, (ic, t, c) in zip(xs, trio):
        carte(s, x, y + 0.8, l, 4.9, t, c, icone=ic)

    encadre(s, MARGE, y + 6.5, L_UTILE, 2.7, "Les statistiques suivent tes lives",
            "L'écran « Vue d'ensemble » compte les commandes utilisées. Les compteurs "
            "repartent de zéro au début de chaque live, pas à chaque lancement de "
            "StreamKit.", couleur=ACCENT)

    numero(s, n, total)
    return s


def slide_souci(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "Si ça coince", surtitre="Dépannage",
              sous="Le journal, en bas de la fenêtre, écrit tout ce que font les "
                   "modules — même plusieurs jours après.")

    image(s, "c-journal.png", MARGE, y + 0.7, largeur=L_UTILE)

    y2 = y + 5.2
    xs, l = rangee(3)
    trio = [
        ("Déplie-le d'un clic",
         "Il est replié par défaut pour ne pas manger l'écran. Un clic sur « Journal » "
         "l'ouvre."),
        ("Filtre ce que tu cherches",
         "Par module, par gravité (erreurs seulement), ou par mot-clé. Le compteur "
         "rouge signale les erreurs."),
        ("Envoie-moi le fichier du jour",
         "Le bouton ⤓ télécharge le journal complet. Avec ça, je vois exactement ce "
         "qui s'est passé."),
    ]
    for x, (t, c) in zip(xs, trio):
        carte(s, x, y2, l, 3.7, t, c, accent=ACCENT)

    numero(s, n, total)
    return s


def slide_recap(prs, n, total):
    s = nouvelle(prs)
    y = titre(s, "L'essentiel sur une page", surtitre="Aide-mémoire")

    lignes = [
        ("Télécharger / mettre à jour", "github.com/45jmpmd6kq-ui/StreamKit/releases",
         "La version la plus récente est toujours en haut."),
        ("Tableau de bord", "http://127.0.0.1:4455",
         "S'ouvre aussi en double-cliquant sur l'icône près de l'horloge."),
        ("Tes réglages et tes codes", "%APPDATA%\\StreamKit",
         "À ne jamais partager. Conservés d'une version à l'autre."),
        ("Overlay dans OBS", "Sources ▸ + ▸ Navigateur ▸ 1920 × 1080",
         "L'adresse se copie depuis l'écran du module."),
    ]

    haut = y + 0.7
    hauteur = 2.45
    for i, (quoi, valeur, note) in enumerate(lignes):
        cy = haut + i * (hauteur + 0.45)
        c = rect(s, MARGE, cy, L_UTILE, hauteur, fond=SURFACE, bordure=BORDURE,
                 arrondi=0.12)
        tf = c.text_frame
        tf.margin_left = Cm(0.9)
        tf.margin_right = Cm(0.9)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        para(tf, quoi, taille=13, couleur=DOUX, espace_apres=3, premier=True)
        riche(tf, [(valeur, TEXTE, True, POLICE_MONO)], taille=14, espace_apres=0)

        tf2 = zone_texte(s, MARGE + L_UTILE / 2 + 1.0, cy + 0.75,
                         L_UTILE / 2 - 2.0, hauteur - 1.0)
        para(tf2, note, taille=12, couleur=DOUX, espace_apres=0, interligne=1.15,
             premier=True)

    pied(s, "Un souci, une idée de module ? Envoie le journal du jour, tout y est "
            "écrit.")
    numero(s, n, total)
    return s


# --- Assemblage ------------------------------------------------------------


def main():
    prs = Presentation()
    prs.slide_width = Cm(L_SLIDE)
    prs.slide_height = Cm(H_SLIDE)

    fabriques = [
        slide_probleme, slide_solution, slide_modules, slide_live, slide_maj,
        slide_securite, slide_separateur, slide_installer, slide_twitch,
        slide_spotify, slide_activer, slide_obs, slide_pendant, slide_souci,
        slide_recap,
    ]
    total = len(fabriques) + 1

    slide_titre(prs)
    for i, f in enumerate(fabriques, start=2):
        f(prs, i, total)

    prs.save(SORTIE)
    print("%s — %d slides" % (SORTIE.name, len(prs.slides.__iter__.__self__._sldIdLst)))


if __name__ == "__main__":
    main()
