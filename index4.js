const skeldjs = require("@skeldjs/client");
const protocol = require("@skeldjs/protocol");
const { Vector2, Int2Code, HazelWriter } = require("@skeldjs/util");

const getPixels = require("get-pixels");
const fs = require("fs");

const client = new skeldjs.SkeldjsClient("2021.6.30s", { attemptAuth: true });

const getPixelsAsync = (url) => {
    return new Promise((res, rej) => {
        getPixels(url, "image/png", (err, pix) => err ? rej(err) : res(pix));
    });
}

var baseColors = [...Object.entries(skeldjs.ColorCodes)].map(([i, clr]) => clr.highlightRGB);

function getNearestColour(rgb) {
    const [ red, green, blue ] = rgb;

    let nearestDist = Infinity;
    let nearestColorIdx;
    for (let i = 0; i < baseColors.length; i++) {
        const baseColor = baseColors[i];
        const [ baseR, baseG, baseB ] = baseColor;

        const diffR = (red - baseR) * (red - baseR);
        const diffG = (green - baseG) * (green - baseG);
        const diffB = (blue - baseB) * (blue - baseB);

        const dist = Math.sqrt(diffR + diffG + diffB);

        if (dist < nearestDist) {
            nearestDist = dist;
            nearestColorIdx = i;
        }
    }

    return nearestColorIdx;
}

const [ , , connectRegion, imagePath, resolutionX, resolutionY ] = process.argv;

(async () => {
    console.log("connecting to server..");
    await client.connect(connectRegion, "weakeyes", 22023);

    console.log("creating..");
    await client.createGame({ maxPlayers: 15 });

    console.log("code:", Int2Code(client.code));

    console.log("parsing image..");
    const imagePixels = await getPixelsAsync(fs.readFileSync(imagePath));
    const imageWidth = imagePixels.shape[0];
    const imageHeight = imagePixels.shape[1];

    const resX = parseInt(resolutionX);
    const resY = parseInt(resolutionY);

    const minAlpha = 127;
    const playerDensity = 3;
    const playerName = " ";

    console.log("waiting for chat message..");
    await client.wait("player.chat");

    /**
     * @type {{components: [ skeldjs.PlayerControl, unknown, skeldjs.CustomNetworkTransform ]}[]}
     */
    const players = [];
    let incrPlayerId = 2;
    for (let y = 0; y < resY; y++) {
        for (let x = 0; x < resX; x++) {
            const pixelX = Math.floor(imageWidth / resX * x); // get this corresponding pixel for this player
            const pixelY = Math.floor(imageHeight / resY * y);

            const pixelI = (pixelX + (pixelY * imageWidth)) * 4;
            const pixelClr = imagePixels.data.slice(pixelI, pixelI + 4); // the array is completely flat values of rgba, so get that slice of colors

            if (pixelClr[3] < minAlpha) { // if alpha < 127, we can round this down to being completely transparent
                continue;
            }

            const skeldjsColor = getNearestColour(pixelClr);

            const pcNetId = client.getNextNetId(); // get player component netids
            const ppNetId = client.getNextNetId();
            const cntNetId = client.getNextNetId();
    
            const playerId = incrPlayerId++; // get next player id to use, maxes out at 255 which limits resolution
    
            const transform = new skeldjs.CustomNetworkTransform(client, cntNetId, -2, {
                position: new Vector2(x / playerDensity - (resX * playerDensity / 2), -(y / playerDensity) + (resY * playerDensity / 2)) // set player position to be around the centre of the map
            });

            const transformWriter = HazelWriter.alloc(12); // write the customnetworktransform component
            transform.Serialize(transformWriter, false);
    
            const gamedataWriter = HazelWriter.alloc(4 + playerName.length + 6); // write the player's info to gamedata
            const mwriter = gamedataWriter.begin(playerId);
            mwriter.string(playerName);
            mwriter.packed(skeldjsColor);
            mwriter.upacked(0);
            mwriter.upacked(0);
            mwriter.upacked(0);
            mwriter.byte(0);
            mwriter.uint8(0);
            gamedataWriter.end();
    
            await client.send(
                new protocol.ReliablePacket(
                    client.getNextNonce(),
                    [
                        new protocol.GameDataMessage(
                            client.code,
                            [
                                new protocol.SpawnMessage(
                                    skeldjs.SpawnType.Player,
                                    client.hostid,
                                    0,
                                    [
                                        new protocol.ComponentSpawnData(
                                            pcNetId,
                                            Buffer.from("00" + playerId.toString(16).padStart(2, "0"), "hex")
                                        ),
                                        new protocol.ComponentSpawnData(
                                            ppNetId,
                                            Buffer.alloc(0)
                                        ),
                                        new protocol.ComponentSpawnData(
                                            cntNetId,
                                            transformWriter.buffer
                                        )
                                    ]
                                ),
                                new protocol.RpcMessage(
                                    pcNetId,
                                    new protocol.SetNameMessage(playerName)
                                ),
                                new protocol.RpcMessage(
                                    pcNetId,
                                    new protocol.SetColorMessage(skeldjsColor)
                                ),
                                new protocol.DataMessage(
                                    client.gamedata.netid,
                                    gamedataWriter.buffer
                                )
                            ]
                        )
                    ]
                )
            );
            
            players.push({
                pcNetId,
                ppNetId,
                cntNetId,
                playerId,
                seqId: 5
            });
        }
    }
})();