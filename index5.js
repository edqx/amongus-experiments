const skeldjs = require("@skeldjs/client");
const protocol = require("@skeldjs/protocol");
const { Vector2, Int2Code, HazelWriter, sleep } = require("@skeldjs/util");

const getPixels = require("get-pixels");
const fs = require("fs");
const path = require("path");
const { DespawnMessage } = require("@skeldjs/protocol");

let lastTime = Date.now();
let numBytes = 0;
class HookedClient extends skeldjs.SkeldjsClient {
    _send(buffer) {
        numBytes += buffer.byteLength;
        if (Date.now() - lastTime > 1000) {
            console.log("sent " + numBytes + "byte(s) last second");
            numBytes = 0;
            lastTime = Date.now();
        }
        super._send(buffer);
    }
}

const client = new HookedClient("2021.6.30s", { attemptAuth: false });

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

const createGroupedArray = function (arr, chunkSize) {
    if (!Number.isInteger(chunkSize)) {
        throw 'Chunk size must be an integer.';
    }

    if (chunkSize < 1) {
        throw 'Chunk size must be greater than 0.';
    }

    const groups = [];
    let i = 0;
    while (i < arr.length) {
        groups.push(arr.slice(i, i += chunkSize));
    }
    return groups;
};

let nonce = 100;
function getNextNonce() {
    if (nonce >= 65535) {
        nonce = 0;
    }
    nonce++;
    return nonce;
}

(async () => {
    console.log("connecting to server..");
    await client.connect(connectRegion, "weakeyes", 22023);

    console.log("creating..");
    await client.createGame({ maxPlayers: 15 });

    console.log("code:", Int2Code(client.code));

    console.log("parsing image..");

    const resX = parseInt(resolutionX);
    const resY = parseInt(resolutionY);

    const minAlpha = 127;
    const playerDensityX = 6;
    const skippedFrames = 4;
    const frameRate = 1000 / 24 * skippedFrames;
    const playerDensityY = playerDensityX * 1.666;
    const playerName = " ";

    console.log("waiting for chat message..");
    const chat = await client.wait("player.chat");

    chat.player.control.setName("edward#2222");

    client.lobbybehaviour.despawn();
    
    await sleep(5000);

    const cacheColors = new Map;
    const cachedPlayersLol = new Map;

    let spawned = [];
    async function despawnAll() {
        const messages = spawned.map(spawn => {
            return new DespawnMessage(spawn)
        });

        const chunked = createGroupedArray(messages, 8);

        for (const chunk of chunked) {
            await client.send(
                new protocol.ReliablePacket(
                    getNextNonce(),
                    [
                        new protocol.GameDataMessage(
                            client.code,
                            chunk
                        )
                    ]
                )
            );
        }

        spawned = [];
    }

    let incrPlayerId = 2;
    async function renderFrame(frameData) {
        const imagePixels = await getPixelsAsync(frameData);
        const imageWidth = imagePixels.shape[0];
        const imageHeight = imagePixels.shape[1];

        const colorUpdates = [];

        /**
         * @type {{components: [ skeldjs.PlayerControl, unknown, skeldjs.CustomNetworkTransform ]}[]}
         */
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
                const cachedPlayer = cachedPlayersLol.get(x + ":" + y);

                if (cachedPlayer) {
                    if (cachedPlayer.color !== skeldjsColor) {
                        colorUpdates.push(
                            new protocol.RpcMessage(
                                cachedPlayer.netid,
                                new protocol.SetColorMessage(skeldjsColor)
                            )
                        );
                        cachedPlayer.color = skeldjsColor;
                    }
                    continue;
                }
    
                const netids = await spawnPlayer(skeldjsColor, x, y);
                cachedPlayersLol.set(x + ":" + y, {
                    netid: netids[0],
                    color: skeldjsColor
                });
                spawned.push(...netids);
            }
        }

        const chunkedColorUpdates = createGroupedArray(colorUpdates, 8);
        for (const chunk of chunkedColorUpdates) {
            await client.send(
                new protocol.ReliablePacket(
                    getNextNonce(),
                    [
                        new protocol.GameDataMessage(
                            client.code,
                            chunk
                        )
                    ]
                )
            );
        }
    }

    async function spawnPlayer(colorId, x, y) {
        const cachedColor = cacheColors.get(colorId);

        const pcNetId = client.getNextNetId(); // get player component netids
        const ppNetId = client.getNextNetId();
        const cntNetId = client.getNextNetId();

        const transform = new skeldjs.CustomNetworkTransform(client, cntNetId, -2, {
            position: new Vector2(x / playerDensityX - (resX / playerDensityX / 2), -(y / playerDensityY) + (resY / playerDensityY / 2)) // set player position to be around the centre of the map
        });

        const transformWriter = HazelWriter.alloc(12); // write the customnetworktransform component
        transform.Serialize(transformWriter, false);

        if (cachedColor) {
            await client.send(
                new protocol.ReliablePacket(
                    getNextNonce(),
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
                                            Buffer.from("00" + cachedColor.toString(16).padStart(2, "0"), "hex")
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
                                    new protocol.SetColorMessage(colorId)
                                )
                            ]
                        )
                    ]
                )
            );

            return [ pcNetId, ppNetId, cntNetId ];
        }

        const playerId = incrPlayerId++; // get next player id to use, maxes out at 255 which limits resolution
        
        cacheColors.set(colorId, playerId);

        const gamedataWriter = HazelWriter.alloc(4 + playerName.length + 6); // write the player's info to gamedata
        const mwriter = gamedataWriter.begin(playerId);
        mwriter.string(playerName);
        mwriter.packed(colorId);
        mwriter.upacked(0);
        mwriter.upacked(0);
        mwriter.upacked(0);
        mwriter.byte(0);
        mwriter.uint8(0);
        gamedataWriter.end();

        await client.send(
            new protocol.ReliablePacket(
                getNextNonce(),
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
                                new protocol.SetColorMessage(colorId)
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

        await sleep(200);
        
        return [ pcNetId, ppNetId, cntNetId ];
    }

    const filesInDir = fs.readdirSync(imagePath);

    for (const frameFile of filesInDir) {
        const begin = Date.now();
        const frameData = fs.readFileSync(path.join(imagePath, frameFile));

        await renderFrame(frameData);
        const took = Date.now() - begin;

        await sleep(frameRate - took);
    }
})();